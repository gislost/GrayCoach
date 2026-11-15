// Claude as the coach: turns the engine report into a review, and answers follow-up questions.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import { CLASSES, formatEval } from './analysis.js';
import { movePrefix } from './game.js';

const BETAS = ['server-side-fallback-2026-07-01'];

export const ReviewSchema = z.object({
  headline: z.string().describe('One punchy sentence that sums up the game for the student.'),
  summary: z.string().describe('2-4 sentences: how the game went and the real reason it was won, lost or drawn.'),
  opening: z.string().describe('1-3 sentences on the opening phase from the student\'s side.'),
  middlegame: z.string().describe('1-3 sentences on the middlegame.'),
  endgame: z.string().nullable().describe('1-3 sentences on the endgame, or null if the game ended before one.'),
  key_moments: z
    .array(
      z.object({
        ply: z.number().describe('The ply number from the move table where this moment happened (the move that was played).'),
        title: z.string().describe('Short label, e.g. "Missed fork" or "Hung the bishop".'),
        explanation: z.string().describe('What happened and why it mattered, grounded in the engine data.'),
        better_move: z.string().nullable().describe('The engine-preferred move in SAN (e.g. "Nf3"), or null if the played move was fine.'),
        lesson: z.string().describe('The general lesson to take from this moment.'),
      }),
    )
    .describe('3-6 turning points, in game order, focused on the student\'s decisions.'),
  strengths: z.array(z.string()).describe('2-4 things the student did well.'),
  weaknesses: z.array(z.string()).describe('2-4 recurring problems shown in this game.'),
  tips: z
    .array(z.object({ title: z.string(), detail: z.string() }))
    .describe('3-5 specific, actionable tips for the student\'s level.'),
  training_focus: z.string().describe('The one thing to practise next, with a concrete drill or exercise.'),
});

const REVIEW_SYSTEM = `You are an encouraging but honest chess coach reviewing a finished game with your student.

You receive a move-by-move report from Stockfish. Treat the engine data as ground truth:
- Every concrete claim (a tactic, a better move, who was better) must be supported by the engine evaluations and lines in the report. Do not invent variations or tactics that aren't there; if you explain why a move is bad, reason from the engine's line.
- Evaluations are in pawns from White's point of view. Grades: inaccuracy (?!), mistake (?), blunder (??) come from the drop in winning chances.
- Refer to moves with numbers, e.g. "14. exd5" for White or "14... Nf6" for Black.

Coach the student (the side named in the report). Mention the opponent's errors mainly when the student failed to punish them. Estimate the student's level from the ratings and time control and pitch the advice at that level: practical habits and patterns, not engine-speak. Keep it concise, warm and specific to this game.`;

const CHAT_SYSTEM = `You are the student's chess coach. You already reviewed the game below with them, and now they're asking follow-up questions while clicking through the moves.

Rules:
- Ground concrete claims in the engine report and engine lines provided. If the engine data doesn't settle a question, say so plainly instead of guessing at variations.
- Answer the question asked, briefly (usually 2-6 sentences). Plain text; you may use short "- " bullet lists and **bold**.
- Refer to moves with numbers, e.g. "14. exd5" or "14... Nf6".`;

export class CoachError extends Error {}

function makeClient(apiKey) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

function friendlyError(e) {
  if (e instanceof CoachError) return e;
  if (e instanceof Anthropic.AuthenticationError) return new CoachError('Your Anthropic API key was rejected. Check it in Settings.');
  if (e instanceof Anthropic.PermissionDeniedError) return new CoachError("This API key isn't allowed to use that model. Pick another model in Settings.");
  if (e instanceof Anthropic.NotFoundError) return new CoachError('That model was not found. Pick another model in Settings.');
  if (e instanceof Anthropic.RateLimitError) return new CoachError('The Anthropic API is rate limiting this key. Wait a minute and try again.');
  if (e instanceof Anthropic.APIConnectionError) return new CoachError("Couldn't reach the Anthropic API. Check your connection and try again.");
  if (e instanceof Anthropic.APIError) return new CoachError(`Anthropic API error${e.status ? ` (${e.status})` : ''}: ${e.message}`);
  return new CoachError(e?.message || String(e));
}

function checkStop(msg) {
  if (msg.stop_reason === 'refusal') {
    const why = msg.stop_details?.explanation;
    throw new CoachError('The coach declined this request' + (why ? `: ${why}` : '.'));
  }
  if (msg.stop_reason === 'max_tokens') throw new CoachError('The reply was cut off before it finished. Try again.');
}

function pct(x) {
  return x == null ? 'n/a' : `${x.toFixed(1)}%`;
}

function countsLine(c = {}) {
  const plural = { inaccuracy: 'inaccuracies', mistake: 'mistakes', blunder: 'blunders' };
  const parts = [];
  for (const k of ['inaccuracy', 'mistake', 'blunder']) if (c[k]) parts.push(`${c[k]} ${c[k] > 1 ? plural[k] : k}`);
  if (c.missed) parts.push(`${c.missed} missed chance${c.missed > 1 ? 's' : ''}`);
  return parts.length ? parts.join(', ') : 'no inaccuracies, mistakes or blunders';
}

/** Plain-text report of the game and engine analysis that both prompts are built on. */
export function buildGameReport({ game, graded, playerColor, depth, site, url }) {
  const h = game.headers;
  const name = (c) => (c === 'white' ? h.White : h.Black) || (c === 'white' ? 'White' : 'Black');
  const elo = (c) => (c === 'white' ? h.WhiteElo : h.BlackElo);
  const lines = [];
  lines.push(`Site: ${site || 'unknown'}${url ? ` (${url})` : ''}`);
  lines.push(`White: ${name('white')}${elo('white') ? ` (${elo('white')})` : ''}`);
  lines.push(`Black: ${name('black')}${elo('black') ? ` (${elo('black')})` : ''}`);
  lines.push(`Result: ${h.Result || '?'}${h.Termination ? ` (${h.Termination})` : ''}`);
  if (h.TimeControl) lines.push(`Time control: ${h.TimeControl} (seconds[+increment])`);
  if (h.Opening || h.ECO) lines.push(`Opening: ${[h.ECO, h.Opening].filter(Boolean).join(' ')}`);
  if (game.startFen && !game.startFen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w')) {
    lines.push(`Custom start position: ${game.startFen}`);
  }
  lines.push(
    playerColor
      ? `The student played ${playerColor === 'white' ? 'White' : 'Black'} (${name(playerColor)}).`
      : 'Which side the student played is unknown: review the game for both sides.',
  );
  lines.push('');
  lines.push(`Engine: Stockfish 19 (lite NNUE), depth ${depth}. Evals in pawns from White's point of view; "#3" = White mates in 3, "#-3" = Black mates in 3.`);
  lines.push(`Accuracy: White ${pct(graded.accuracy.w)} (avg centipawn loss ${Math.round(graded.acpl.w ?? 0)}), Black ${pct(graded.accuracy.b)} (avg centipawn loss ${Math.round(graded.acpl.b ?? 0)}).`);
  lines.push(`White: ${countsLine(graded.counts.w)}. Black: ${countsLine(graded.counts.b)}.`);
  lines.push('');
  lines.push('Moves (ply | move | eval after | grade | engine preference):');
  for (const m of graded.moves) {
    const grade = CLASSES[m.cls].label.toLowerCase();
    let row = `${m.ply} | ${movePrefix(m)} ${m.san} | ${formatEval(m.evalAfter)} | ${grade}`;
    if (m.cls !== 'best' && m.cls !== 'forced' && m.bestSan && m.bestUci !== m.uci) {
      if (m.cls === 'excellent' || m.cls === 'good') row += ` | engine slightly preferred ${m.bestSan}`;
      else row += ` | lost ${Math.round(m.loss * 100)}% win chance; engine: ${m.bestLine || m.bestSan}`;
    }
    if (m.missed) row += ' | MISSED CHANCE to punish the previous move';
    lines.push(row);
  }
  const last = game.positions.at(-1);
  lines.push('');
  lines.push(`Final position (FEN): ${last.fen}`);
  return lines.join('\n');
}

/** Full coach review as structured data. */
export async function getReview({ apiKey, model, report }) {
  const client = makeClient(apiKey);
  let msg;
  try {
    msg = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      betas: BETAS,
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(ReviewSchema) },
      system: REVIEW_SYSTEM,
      messages: [{ role: 'user', content: `Here is the game report. Write the coach review.\n\n<game_report>\n${report}\n</game_report>` }],
    });
  } catch (e) {
    throw friendlyError(e);
  }
  checkStop(msg);
  if (!msg.parsed_output) throw new CoachError("The coach's reply couldn't be read. Try again.");
  return { review: msg.parsed_output, model: msg.model };
}

/**
 * Follow-up question about the current position.
 * @param {{role:'user'|'assistant', content:string}[]} history  earlier turns (already include their context)
 */
export async function askCoach({ apiKey, model, report, review, history, question, positionContext }) {
  const client = makeClient(apiKey);
  const system = [
    {
      type: 'text',
      text: `${CHAT_SYSTEM}\n\n<game_report>\n${report}\n</game_report>` + (review ? `\n\n<your_review>\n${JSON.stringify(review)}\n</your_review>` : ''),
      cache_control: { type: 'ephemeral' },
    },
  ];
  const userTurn = `<current_position>\n${positionContext}\n</current_position>\n\n${question}`;
  const messages = [...history, { role: 'user', content: userTurn }];
  let msg;
  try {
    msg = await client.beta.messages.create({
      model,
      max_tokens: 8000,
      betas: BETAS,
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system,
      messages,
    });
  } catch (e) {
    throw friendlyError(e);
  }
  checkStop(msg);
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) throw new CoachError('The coach returned an empty answer. Try again.');
  return { text, userTurn };
}

/** Cheap check that the key works (model metadata lookup, no tokens billed). */
export async function verifyKey(apiKey, model) {
  try {
    const m = await makeClient(apiKey).models.retrieve(model);
    return m.display_name || m.id;
  } catch (e) {
    throw friendlyError(e);
  }
}

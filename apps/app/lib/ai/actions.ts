/**
 * Nilo's one-shot AI actions: bounded operations on the member's own text,
 * with no conversation or memory, so they go Nilo -> Oxy -> Kaana (an
 * assistant goes through Alia). Each action is an instruction; the answer is
 * Markdown that becomes blocks.
 */

export type AiActionId =
  | 'improve'
  | 'fixSpelling'
  | 'shorter'
  | 'longer'
  | 'simplify'
  | 'summarize'
  | 'translate';

/** Languages a translation can go to, by their BCP 47 tag. */
export const TRANSLATION_LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'zh'] as const;
export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];

/** What a block's AI menu offers, in this order. */
export const BLOCK_ACTIONS: readonly AiActionId[] = [
  'improve',
  'fixSpelling',
  'shorter',
  'longer',
  'simplify',
  'summarize',
  'translate',
];

const LANGUAGE_NAMES: Record<TranslationLanguage, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  it: 'Italian',
  ja: 'Japanese',
  zh: 'Chinese (Simplified)',
};

const OUTPUT_RULES =
  'Answer with the result only, as Markdown: no preamble, no quotation marks around it, ' +
  'no explanation. Keep the Markdown structure (headings, lists, to-dos, links) of the text ' +
  'unless the task changes it.';

const SAME_LANGUAGE = 'Write in the same language as the text.';

/** The instruction each action gives, with the rules every answer follows. */
export function instructionFor(action: AiActionId, language?: TranslationLanguage): string {
  const task: Record<AiActionId, string> = {
    improve: `Improve the writing of the text: clearer and more fluent, same meaning and tone. ${SAME_LANGUAGE}`,
    fixSpelling: `Fix the spelling, grammar and punctuation of the text. Change nothing else. ${SAME_LANGUAGE}`,
    shorter: `Make the text shorter, keeping what matters. ${SAME_LANGUAGE}`,
    longer: `Make the text longer, developing what it says without inventing facts. ${SAME_LANGUAGE}`,
    simplify: `Rewrite the text in simpler words that anyone can follow. ${SAME_LANGUAGE}`,
    summarize: `Summarize the text in a few short bullet points. ${SAME_LANGUAGE}`,
    translate: `Translate the text into ${LANGUAGE_NAMES[language ?? 'en']}.`,
  };
  return `${task[action]} ${OUTPUT_RULES}`;
}

/** The longest text an action sends, in characters; longer text is refused before sending. */
export const MAX_INPUT_CHARS = 24_000;

/** The messages one action sends: the instruction, then the member's text. */
export function messagesFor(action: AiActionId, text: string, language?: TranslationLanguage) {
  return [
    {
      role: 'system' as const,
      content: [{ type: 'text' as const, text: instructionFor(action, language) }],
    },
    { role: 'user' as const, content: [{ type: 'text' as const, text }] },
  ];
}

/** The text of an answer: every text part the assistant wrote, in order. */
export function answerText(
  output: readonly { role: string; content: readonly { type: string; text?: string }[] }[],
): string {
  return output
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.content)
    .flatMap((part) => (part.type === 'text' && part.text ? [part.text] : []))
    .join('')
    .trim();
}

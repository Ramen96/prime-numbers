/** "Is any of my data sent anywhere?" → "is-any-of-my-data-sent-anywhere", for links like /about#… */
export function anchorForQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const DATA_FAQ_QUESTION = "Is any of my data sent anywhere?";
/** Where the storage notice's "Learn more" link points. */
export const DATA_FAQ_LINK = `/about#${anchorForQuestion(DATA_FAQ_QUESTION)}`;

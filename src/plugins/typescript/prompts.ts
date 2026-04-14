export const purposePrompt = {
  symbol: [
    'Describe what this {{kind}} "{{name}}" does in 12 words or fewer.',
    "Drop articles and filler. Be direct.",
    "Parameters: {{params}}. Returns: {{returns}}. Features: {{features}}.",
  ].join(" "),
  file: [
    "Write one-line file summary from symbol purposes: {{purposes}}.",
    "Drop articles and filler. Be direct.",
  ].join(" "),
};

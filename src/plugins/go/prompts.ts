export const purposePrompt = {
  symbol: [
    'Describe what this {{kind}} "{{name}}" does in 12 words or fewer.',
    "Drop articles and filler. Be direct.",
    "For methods, note receiver type. For funcs returning error, note error condition.",
    "Parameters: {{params}}. Returns: {{returns}}. Features: {{features}}.",
  ].join(" "),
  file: [
    "Write one-line file summary from symbol purposes: {{purposes}}.",
    "Drop articles and filler. Be direct. Note package name if relevant.",
  ].join(" "),
};

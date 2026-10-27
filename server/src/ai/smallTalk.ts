import { norm } from './text';

// Thanks, greetings and goodbyes, answered by the server with no model call and no tool.
// In testing, "thank you for making my work easy" on the Exports page made the model repeat
// the last download: a message that asks for nothing must never run a tool.

const THANKS = /^(?:(?:ok|okay|great|awesome|perfect|nice|cool|wow|super|excellent|brilliant|amazing)\s+)*(?:thanks?|thank you|thank u|thankyou|thx|ty|cheers|shukriya|dhanyavaad|dhanyavad|dhanyawad)\b/;
const PRAISE =
  /^(?:great|awesome|perfect|nice|cool|super|excellent|brilliant|amazing|wonderful|fantastic|good job|well done|love it|you (?:are|re) (?:the best|great|awesome|amazing|a star)|that (?:s|is|was) (?:great|perfect|helpful|nice|awesome|amazing|exactly what i needed)|this (?:is|was) (?:great|perfect|helpful|awesome))\b/;
const OK = /^(?:ok|okay|k|got it|alright|all right|sure|fine|noted|understood|cool|hmm+)$/;
const HELLO = /^(?:hi+|hello|hey|hiya|good (?:morning|afternoon|evening)|namaste|how are you)\b/;
const BYE = /^(?:bye|goodbye|good bye|see you|see ya|good night|ttyl|later)\b/;

// Anything that asks for something: then the message goes on to the module as usual. Question
// words count only at the start ("That's exactly what I needed" asks for nothing).
const REQUEST =
  /\b(?:download|export|show|list|find|search|create|add|upload|delete|remove|update|change|edit|mark|rename|move|assign|count|give|send|get|open|apply|approve|reject|set|put|push|archive|restore|replace|make it|do it|now|also|again|can you|could you|would you|please do)\b/;
const QUESTION = /^(?:what|whats|which|who|when|where|how many|how much|why)\b/;

/** The server's own reply to a message that only thanks, greets or says goodbye; null for anything else. */
export function smallTalkReply(text: string): string | null {
  const t = norm(text);
  if (!t || REQUEST.test(t) || QUESTION.test(t)) return null;
  if (THANKS.test(t)) return "You're welcome!";
  if (PRAISE.test(t)) return 'Glad it helped!';
  if (BYE.test(t)) return "Bye! I'm here whenever you need me.";
  if (HELLO.test(t)) return 'Hi! What would you like to do?';
  if (OK.test(t)) return 'OK.';
  return null;
}

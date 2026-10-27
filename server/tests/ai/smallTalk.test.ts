import { smallTalkReply } from '../../src/ai/smallTalk';

describe('smallTalkReply', () => {
  it.each([
    ['Thank you for making my work easy', "You're welcome!"],
    ['thanks!', "You're welcome!"],
    ['Great, thanks a lot', "You're welcome!"],
    ['Thanks for the projects CSV', "You're welcome!"],
    ['Shukriya', "You're welcome!"],
    ["That's exactly what I needed", 'Glad it helped!'],
    ['You are the best', 'Glad it helped!'],
    ['Perfect', 'Glad it helped!'],
    ['Good morning', 'Hi! What would you like to do?'],
    ['bye', "Bye! I'm here whenever you need me."],
    ['ok', 'OK.'],
  ])('answers "%s" itself', (text, reply) => {
    expect(smallTalkReply(text)).toBe(reply);
  });

  it.each(['Thanks, now download tasks too', 'Thank you, can you also export employees?', 'Hi, show me my tasks', 'Download projects', 'Done', 'Mark the login bug as done'])(
    'leaves "%s" to the module: it asks for something',
    (text) => {
      expect(smallTalkReply(text)).toBeNull();
    }
  );
});

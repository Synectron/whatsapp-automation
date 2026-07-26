/** One-off smoke test: exercises the real AI follow-up path with a fake message. */
import { aiService } from '../src/ai';

(async () => {
  const result = await aiService.followUp({
    groupId: 1,
    groupName: 'Test Group',
    authorName: 'Customer',
    message: 'Hi, I looked at the website mockup but I am confused about the pricing page. Can someone help?',
    recentMessages: [{ author: 'Customer', body: 'Hello, is anyone there?' }],
    persona: 'You are Softcoe Bot, a polite and helpful project assistant.',
    enabled: true,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})().catch((err) => {
  console.error('AI TEST FAILED:', err.message);
  process.exit(1);
});

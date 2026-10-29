const port = Number(process.env.PORT) || 4780;
const prompt = process.argv.slice(2).join(' ').trim();

if (!prompt) {
  console.log('ব্যবহার: npm run task -- "যে কাজটি করতে হবে"');
  process.exit(1);
}

try {
  const res = await fetch(`http://127.0.0.1:${port}/api/task`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  console.log(`কাজ শুরু হয়েছে: ${data.task.id}`);
  console.log(`ড্যাশবোর্ড: http://127.0.0.1:${port}`);
} catch (err) {
  console.error(`চালানো যায়নি: ${err.message}`);
  console.error('আগে অন্য টার্মিনালে npm start চালান।');
  process.exit(1);
}

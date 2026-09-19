const repos = [
  "achimala/dream-loop",
  "jtydhr88/screenwriting-skills",
  "viettranx/3dviz-pro-max",
  "feitangyuan/motion-web",
  "mcncarl/jianying-headless",
  "agentverse-os/AgentVerse-OS",
  "atria-asi/Atria-Dawn-Preview",
  "shinthink/blitzstrike",
  "AetherLabsAI/RSIAgent",
  "youngyangyang04/llm-master",
  "showlab/Show-Harness"
];
for (const r of repos) {
  const res = await fetch(`https://api.github.com/repos/${r}`);
  const d = await res.json();
  console.log(r, '| stars:', d.stargazers_count, '| forks:', d.forks_count, '| created:', d.created_at, '| pushed:', d.pushed_at);
  const commitsRes = await fetch(`https://api.github.com/repos/${r}/commits?per_page=1`);
  const link = commitsRes.headers.get('link');
  console.log('  commits link:', link);
}

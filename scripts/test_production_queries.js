async function runTests() {
  const tests = [
    {
      name: "1. Greeting",
      query: "hi how are you doing",
      convId: "conv_demo",
    },
    {
      name: "2. General Science (Photosynthesis)",
      query: "what is photosynthesis and why is it important?",
      convId: "conv_demo",
    },
    {
      name: "3. General Coding (Python Factorial)",
      query: "write a python function to find the factorial of a number with comments",
      convId: "conv_demo",
    },
    {
      name: "4. File-Specific Grounded Query (VoltBus V3 Battery)",
      query: "What is the battery capacity of VoltBus V3?",
      convId: "conv_demo",
    },
  ];

  for (const t of tests) {
    console.log(`\n========================================`);
    console.log(`=== TEST: ${t.name} ===`);
    console.log(`Query: "${t.query}"`);
    const start = Date.now();
    try {
      const res = await fetch("http://13.203.136.117:8001/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: t.convId,
          query: t.query,
          top_k: 5,
        }),
      });
      const elapsed = Date.now() - start;
      const data = await res.json();
      console.log(`Status: HTTP ${res.status} in ${elapsed}ms`);
      console.log(`Routed Categories:`, data.routed_categories);
      console.log(`Citations Count:`, data.citations?.length || 0);
      console.log(`Confidence:`, data.confidence);
      console.log(`Groundedness Score:`, data.groundedness_score);
      console.log(`\nAnswer Preview:\n${data.answer?.slice(0, 400)}...\n`);
    } catch (e) {
      console.error(`Test failed:`, e.message);
    }
  }
}

runTests();

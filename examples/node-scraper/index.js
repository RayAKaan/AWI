/**
 * Node.js Agent Example
 * 
 * Uses @awi-protocol/sdk to scrape job listings deterministically.
 */

const { AWIClient } = require('@awi-protocol/sdk');

async function main() {
  const client = new AWIClient({
    endpoint: process.env.AWI_ENDPOINT || 'http://localhost:8000',
    certificate: process.env.AWI_CERTIFICATE,
  });

  // Check health
  const health = await client.health();
  console.log('Server status:', health.status);

  // Search for jobs
  const result = await client.execute({
    target: 'awi://linkedin.com/jobs/search/v1',
    params: {
      query: 'senior software engineer',
      location: 'San Francisco',
    },
  });

  if (result.success) {
    console.log(`Found ${result.data.length} jobs:`);
    for (const job of result.data) {
      console.log(`- ${job.title} at ${job.company}`);
    }

    // Submit feedback
    await client.feedback({
      execution_id: result.metadata.execution_id,
      rating: 'good',
      notes: 'Accurate results',
    });
  } else {
    console.error('Execution failed:', result.errors);
  }
}

main().catch(console.error);

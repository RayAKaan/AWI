/**
 * Next.js API Route Example
 * 
 * Uses @awi-protocol/sdk to fetch job data server-side.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { AWIClient } from '@awi-protocol/sdk';

const client = new AWIClient({
  endpoint: process.env.AWI_ENDPOINT!,
  certificate: process.env.AWI_CERTIFICATE!,
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { query, location } = req.body;

  try {
    const result = await client.execute({
      target: 'awi://linkedin.com/jobs/search/v1',
      params: { query, location },
    });

    if (result.success) {
      return res.status(200).json({
        jobs: result.data,
        metadata: result.metadata,
      });
    } else {
      return res.status(502).json({
        error: 'Execution failed',
        details: result.errors,
      });
    }
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

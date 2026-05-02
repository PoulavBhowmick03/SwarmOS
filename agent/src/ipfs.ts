const PINATA_API = "https://api.pinata.cloud/pinning/pinJSONToIPFS";

function localFallbackCID(payload: unknown): string {
  const seed = JSON.stringify(payload).slice(0, 120);
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  }
  return `local:fallback-${Date.now()}-${hash.toString(16)}`;
}

export async function pinToIPFS(data: object): Promise<string> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    throw new Error("PINATA_JWT not configured");
  }

  const response = await fetch(PINATA_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      pinataContent: data,
      pinataMetadata: {
        name: `spawn-postmortem-${Date.now()}`,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Pinata HTTP ${response.status}`);
  }

  const json = (await response.json()) as { IpfsHash?: string };
  if (!json.IpfsHash) {
    throw new Error("Pinata response missing IpfsHash");
  }

  return json.IpfsHash;
}

export async function pinTerminationMemory(report: object): Promise<string | null> {
  try {
    return await pinToIPFS(report);
  } catch {
    return localFallbackCID(report);
  }
}

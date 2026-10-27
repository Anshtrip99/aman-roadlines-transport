const ATLAS_API = 'https://cloud.mongodb.com/api/atlas/v2';
const ATLAS_MEDIA_TYPE = 'application/vnd.atlas.2025-03-12+json';

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

async function responseError(response, context) {
  const details = await response.text().catch(() => '');
  return new Error(`${context} failed (HTTP ${response.status}). ${details.slice(0, 500)}`);
}

async function getPublicIpv4() {
  const response = await fetchWithTimeout('https://api.ipify.org?format=json');
  if (!response.ok) throw await responseError(response, 'Public IP lookup');
  const { ip } = await response.json();
  const validIpv4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  if (!validIpv4.test(ip || '')) throw new Error('Public IP lookup did not return a valid IPv4 address.');
  return ip;
}

async function getAtlasToken(clientId, clientSecret) {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetchWithTimeout('https://cloud.mongodb.com/api/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw await responseError(response, 'Atlas service account authentication');
  const { access_token: token } = await response.json();
  if (!token) throw new Error('Atlas did not return an access token.');
  return token;
}

async function addCurrentIp(projectId, token, ip) {
  const deleteAfterDate = new Date(Date.now() + (7 * 24 - 1) * 60 * 60 * 1000).toISOString();
  const response = await fetchWithTimeout(`${ATLAS_API}/groups/${encodeURIComponent(projectId)}/accessList`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: ATLAS_MEDIA_TYPE,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{ ipAddress: ip, comment: 'Aman Roadlines local development', deleteAfterDate }]),
  });
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    if (response.status === 400 && /already exists|duplicate/i.test(details)) return false;
    throw new Error(`Atlas IP allowlist update failed (HTTP ${response.status}). ${details.slice(0, 500)}`);
  }
  return true;
}

export async function ensureAtlasCurrentIpAllowed() {
  const projectId = process.env.ATLAS_PROJECT_ID?.trim();
  const clientId = process.env.ATLAS_SERVICE_ACCOUNT_CLIENT_ID?.trim();
  const clientSecret = process.env.ATLAS_SERVICE_ACCOUNT_CLIENT_SECRET?.trim();
  const configured = [projectId, clientId, clientSecret].filter(Boolean).length;

  if (!configured) {
    console.log('Atlas startup IP sync is disabled; using the current Atlas access list.');
    return;
  }
  if (configured !== 3) {
    throw new Error('Atlas startup IP sync needs ATLAS_PROJECT_ID, ATLAS_SERVICE_ACCOUNT_CLIENT_ID, and ATLAS_SERVICE_ACCOUNT_CLIENT_SECRET together.');
  }
  if (!/^[a-f0-9]{24}$/i.test(projectId)) {
    throw new Error('ATLAS_PROJECT_ID must be the 24-character Atlas project ID.');
  }

  const ip = await getPublicIpv4();
  const token = await getAtlasToken(clientId, clientSecret);
  const added = await addCurrentIp(projectId, token, ip);
  console.log(added
    ? `Atlas allowlist updated for this machine's public IP (${ip}/32).`
    : `This machine's public IP (${ip}/32) is already allowed in Atlas.`);
}

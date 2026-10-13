import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
export interface AccessConfig {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function verifyAccessToken(
  token: string,
  config: AccessConfig,
  keyOverride?: JWTVerifyGetKey,
) {
  const team = config.ACCESS_TEAM_DOMAIN;
  const aud = config.ACCESS_AUD;
  if (!team || !aud || !/^([a-z0-9-]+)\.cloudflareaccess\.com$/.test(team))
    throw new Error('Access configuration missing');
  let keys = keyOverride || keySets.get(team);
  if (!keys) {
    const remote = createRemoteJWKSet(
      new URL(`https://${team}/cdn-cgi/access/certs`),
    );
    keySets.set(team, remote);
    keys = remote;
  }
  const { payload } = await jwtVerify(token, keys, {
    issuer: `https://${team}`,
    audience: aud,
    algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat', 'sub', 'email'],
  });
  if (typeof payload.email !== 'string' || !payload.email.includes('@'))
    throw new Error('Invalid Access identity');
  return payload.email;
}

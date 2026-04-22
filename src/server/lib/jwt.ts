import { type JWTPayload, jwtVerify, SignJWT } from 'jose'

export interface AccessTokenPayload extends JWTPayload {
  sub: string // pubkey
  permissions: string[]
}

export interface SignOptions {
  expiresIn?: string
}

const DEFAULT_EXPIRES_IN = '15m'

export async function signAccessToken(
  data: { pubkey: string; permissions: string[] },
  secret: string,
  opts?: SignOptions
): Promise<string> {
  const key = new TextEncoder().encode(secret)
  return new SignJWT({ permissions: data.permissions })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(data.pubkey)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(opts?.expiresIn ?? DEFAULT_EXPIRES_IN)
    .setIssuer('llamenos')
    .sign(key)
}

export async function verifyAccessToken(
  token: string,
  secret: string
): Promise<AccessTokenPayload> {
  const key = new TextEncoder().encode(secret)
  const { payload } = await jwtVerify(token, key, {
    issuer: 'llamenos',
    algorithms: ['HS256'],
  })
  return payload as AccessTokenPayload
}

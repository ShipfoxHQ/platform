import {jwtVerify, SignJWT} from 'jose';

export interface SignUserTokenParams {
  userId: string;
  email: string;
  secret: string;
  expiresIn: string;
}

export interface VerifyUserTokenParams {
  token: string;
  secret: string;
}

export interface UserTokenClaims {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signUserToken(params: SignUserTokenParams): Promise<string> {
  return await new SignJWT({email: params.email})
    .setProtectedHeader({alg: 'HS256'})
    .setSubject(params.userId)
    .setIssuedAt()
    .setExpirationTime(params.expiresIn)
    .sign(encodeSecret(params.secret));
}

export async function verifyUserToken(params: VerifyUserTokenParams): Promise<UserTokenClaims> {
  const {payload} = await jwtVerify(params.token, encodeSecret(params.secret), {
    algorithms: ['HS256'],
  });

  if (typeof payload.sub !== 'string') {
    throw new Error('Token missing sub claim');
  }
  if (typeof payload.email !== 'string') {
    throw new Error('Token missing email claim');
  }
  if (typeof payload.iat !== 'number') {
    throw new Error('Token missing iat claim');
  }
  if (typeof payload.exp !== 'number') {
    throw new Error('Token missing exp claim');
  }

  return {
    sub: payload.sub,
    email: payload.email,
    iat: payload.iat,
    exp: payload.exp,
  };
}

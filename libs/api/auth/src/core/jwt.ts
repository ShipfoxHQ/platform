import {workspaceRoleSchema, workspaceStatusSchema} from '@shipfox/api-workspaces-dto';
import {signHs256, verifyHs256} from '@shipfox/node-jwt';
import {z} from 'zod';
import {recordTokenIssued, recordTokenVerified} from '#metrics/index.js';

export const tokenMembershipSchema = z.object({
  workspaceId: z.string().uuid(),
  role: workspaceRoleSchema,
  workspaceStatus: workspaceStatusSchema.default('active'),
});

export type TokenMembership = z.infer<typeof tokenMembershipSchema>;

const impersonatorIdSchema = z.string().uuid();

// UUIDs are case-insensitive hex strings: compare normalized values so a
// re-cased impersonatorId cannot pass off the subject as its own impersonator.
function isSameUuid(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// Rollback hazard: pre-impersonation verifiers strip unknown claims (zod's
// default object parsing), so a marked token verified by an old build silently
// loses the marker. Upgrade every verifier before any issuer mints marked tokens.
export const userTokenClaimsSchema = z
  .object({
    sub: z.string().uuid(),
    refreshSessionId: z.string().uuid().optional(),
    impersonatorId: impersonatorIdSchema.optional(),
    email: z.string().email(),
    name: z.string().nullable().optional(),
    memberships: z.array(tokenMembershipSchema),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .refine(
    (claims) =>
      claims.impersonatorId === undefined || !isSameUuid(claims.impersonatorId, claims.sub),
    {message: 'impersonatorId must differ from sub'},
  );

export type UserTokenClaims = z.infer<typeof userTokenClaimsSchema>;

export interface SignUserTokenParams {
  refreshSessionId?: string | undefined;
  impersonatorId?: string | undefined;
  userId: string;
  email: string;
  name?: string | null | undefined;
  memberships: TokenMembership[];
  secret: string | Uint8Array;
  expiresIn: string;
}

export interface VerifyUserTokenParams {
  token: string;
  secret: string | Uint8Array;
}

export async function signUserToken(params: SignUserTokenParams): Promise<string> {
  if (params.impersonatorId !== undefined) {
    if (!impersonatorIdSchema.safeParse(params.impersonatorId).success) {
      throw new TypeError('impersonatorId must be a UUID');
    }
    if (isSameUuid(params.impersonatorId, params.userId)) {
      throw new TypeError('impersonatorId must differ from userId');
    }
  }

  const token = await signHs256({
    payload: {
      email: params.email,
      name: params.name ?? null,
      memberships: params.memberships,
      refreshSessionId: params.refreshSessionId,
      impersonatorId: params.impersonatorId,
    },
    secret: params.secret,
    expiresIn: params.expiresIn,
    subject: params.userId,
  });
  recordTokenIssued('session');
  return token;
}

export async function verifyUserToken(params: VerifyUserTokenParams): Promise<UserTokenClaims> {
  try {
    const claims = await verifyHs256({
      token: params.token,
      secret: params.secret,
      schema: userTokenClaimsSchema,
    });
    recordTokenVerified('session', 'ok');
    return claims;
  } catch (error) {
    recordTokenVerified('session', 'rejected');
    throw error;
  }
}

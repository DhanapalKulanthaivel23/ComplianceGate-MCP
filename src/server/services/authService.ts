/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import crypto from 'node:crypto';
import { DEMO_ANALYST_TOKEN } from '../../shared/types.ts';

export type UserRole = 'ANALYST' | 'SENIOR_OFFICER' | 'AUDITOR' | 'ADMIN';

export type Permission =
  | 'SCREEN_TRANSACTION'
  | 'VIEW_CASES'
  | 'VIEW_UNREDACTED_EVIDENCE'
  | 'ADJUDICATE_CASE'
  | 'CONFIRM_SANCTIONS_MATCH'
  | 'MANAGE_WATCHLISTS'
  | 'MANAGE_STORAGE_BACKUPS'
  | 'VIEW_SOURCES'
  | 'MANAGE_SOURCES'
  | 'VIEW_SUBJECTS'
  | 'MANAGE_SUBJECTS';

export interface AuthenticatedPrincipal {
  userId: string;
  username: string;
  role: UserRole;
  tenantId: string;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
  authMethod: 'SIGNED_SESSION_TOKEN' | 'LEGACY_DEMO_TOKEN';
}

interface StoredUserAccount {
  userId: string;
  username: string;
  passwordSalt: string;
  passwordHash: string;
  role: UserRole;
  tenantId: string;
  active: boolean;
}

const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  AUDITOR: new Set([
    'VIEW_CASES',
    'VIEW_UNREDACTED_EVIDENCE',
    'VIEW_SOURCES',
    'VIEW_SUBJECTS',
  ]),
  ANALYST: new Set([
    'SCREEN_TRANSACTION',
    'VIEW_CASES',
    'VIEW_UNREDACTED_EVIDENCE',
    'ADJUDICATE_CASE',
    'VIEW_SOURCES',
    'VIEW_SUBJECTS',
    'MANAGE_SUBJECTS',
  ]),
  SENIOR_OFFICER: new Set([
    'SCREEN_TRANSACTION',
    'VIEW_CASES',
    'VIEW_UNREDACTED_EVIDENCE',
    'ADJUDICATE_CASE',
    'CONFIRM_SANCTIONS_MATCH',
    'MANAGE_WATCHLISTS',
    'VIEW_SOURCES',
    'MANAGE_SOURCES',
    'VIEW_SUBJECTS',
    'MANAGE_SUBJECTS',
  ]),
  ADMIN: new Set([
    'SCREEN_TRANSACTION',
    'VIEW_CASES',
    'VIEW_UNREDACTED_EVIDENCE',
    'ADJUDICATE_CASE',
    'CONFIRM_SANCTIONS_MATCH',
    'MANAGE_WATCHLISTS',
    'MANAGE_STORAGE_BACKUPS',
    'VIEW_SOURCES',
    'MANAGE_SOURCES',
    'VIEW_SUBJECTS',
    'MANAGE_SUBJECTS',
  ]),
};

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64');
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export interface AuthServiceOptions {
  isPublicDemo?: boolean;
  signingSecret?: string;
  seedDemoUsers?: boolean;
}

export class AuthService {
  private usersByUsername: Map<string, StoredUserAccount> = new Map();
  private revokedSessions: Set<string> = new Set();
  private readonly signingSecret: string;
  private readonly isPublicDemo: boolean;

  constructor(options?: AuthServiceOptions) {
    const isPublicDemo = options?.isPublicDemo ?? (process.env.IS_PUBLIC_DEMO !== 'false');
    this.isPublicDemo = isPublicDemo;

    if (!isPublicDemo) {
      const secret = options?.signingSecret || process.env.AUTH_JWT_SECRET;
      if (!secret || secret.trim().length === 0) {
        throw new Error('Fatal configuration error: AUTH_JWT_SECRET environment variable is mandatory in enterprise mode.');
      }
      this.signingSecret = secret.trim();
    } else {
      this.signingSecret =
        options?.signingSecret ||
        process.env.AUTH_JWT_SECRET ||
        crypto.createHash('sha256').update('compliancegate-enterprise-hmac-key-2026').digest('hex');
    }

    const shouldSeed = options?.seedDemoUsers ?? isPublicDemo;
    if (shouldSeed) {
      this.seedDefaultAccounts();
    }
  }

  private seedDefaultAccounts(): void {
    const accounts: Array<{
      userId: string;
      username: string;
      password: string;
      role: UserRole;
      tenantId: string;
    }> = [
      {
        userId: 'usr_analyst_alpha',
        username: 'analyst@tenant-alpha.internal',
        password: process.env.DEFAULT_ANALYST_PASSWORD || 'ComplianceAnalyst!2026',
        role: 'ANALYST',
        tenantId: 'tenant_alpha',
      },
      {
        userId: 'usr_officer_alpha',
        username: 'officer@tenant-alpha.internal',
        password: process.env.DEFAULT_OFFICER_PASSWORD || 'SeniorOfficer!2026',
        role: 'SENIOR_OFFICER',
        tenantId: 'tenant_alpha',
      },
      {
        userId: 'usr_auditor_alpha',
        username: 'auditor@tenant-alpha.internal',
        password: process.env.DEFAULT_AUDITOR_PASSWORD || 'ExternalAuditor!2026',
        role: 'AUDITOR',
        tenantId: 'tenant_alpha',
      },
      {
        userId: 'usr_officer_beta',
        username: 'officer@tenant-beta.internal',
        password: process.env.DEFAULT_BETA_PASSWORD || 'BetaOfficer!2026',
        role: 'SENIOR_OFFICER',
        tenantId: 'tenant_beta',
      },
      {
        userId: 'usr_admin_default',
        username: 'admin@compliancegate.internal',
        password: process.env.DEFAULT_ADMIN_PASSWORD || 'ComplianceAdmin!2026',
        role: 'ADMIN',
        tenantId: 'default',
      },
      {
        userId: 'usr_analyst_alpha_short',
        username: 'analyst_alpha',
        password: 'AnalystPassword123!',
        role: 'ANALYST',
        tenantId: 'tenant_alpha',
      },
      {
        userId: 'usr_officer_alpha_short',
        username: 'officer_alpha',
        password: 'OfficerPassword123!',
        role: 'SENIOR_OFFICER',
        tenantId: 'tenant_alpha',
      },
      {
        userId: 'usr_auditor_alpha_short',
        username: 'auditor_alpha',
        password: 'AuditorPassword123!',
        role: 'AUDITOR',
        tenantId: 'tenant_alpha',
      },
      {
        userId: 'usr_analyst_beta_short',
        username: 'analyst_beta',
        password: 'BetaPassword123!',
        role: 'ANALYST',
        tenantId: 'tenant_beta',
      },
    ];

    for (const acc of accounts) {
      this.registerUser(acc.username, acc.password, acc.role, acc.tenantId, acc.userId);
    }
  }

  public registerUser(
    username: string,
    password: string,
    role: UserRole,
    tenantId: string,
    userId = `usr_${crypto.randomUUID().slice(0, 8)}`
  ): { userId: string; username: string; role: UserRole; tenantId: string } {
    const cleanUser = username.trim().toLowerCase();
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    this.usersByUsername.set(cleanUser, {
      userId,
      username: cleanUser,
      passwordSalt: salt,
      passwordHash,
      role,
      tenantId: tenantId.trim() || 'default',
      active: true,
    });
    return { userId, username: cleanUser, role, tenantId };
  }

  public authenticateCredentials(
    username: string,
    password: string,
    ttlSeconds = 3600
  ): { token: string; principal: AuthenticatedPrincipal } {
    const cleanUser = (username || '').trim().toLowerCase();
    const account = this.usersByUsername.get(cleanUser);
    if (!account || !account.active) {
      throw new Error('Invalid username or password.');
    }

    const candidateHash = hashPassword(password || '', account.passwordSalt);
    const expectedBuf = Buffer.from(account.passwordHash, 'hex');
    const candidateBuf = Buffer.from(candidateHash, 'hex');

    if (expectedBuf.length !== candidateBuf.length || !crypto.timingSafeEqual(expectedBuf, candidateBuf)) {
      throw new Error('Invalid username or password.');
    }

    return this.issueSessionToken({
      userId: account.userId,
      username: account.username,
      role: account.role,
      tenantId: account.tenantId,
      ttlSeconds,
    });
  }

  public issueSessionToken(params: {
    userId: string;
    username: string;
    role: UserRole;
    tenantId: string;
    ttlSeconds?: number;
  }): { token: string; principal: AuthenticatedPrincipal } {
    const nowSec = Math.floor(Date.now() / 1000);
    const ttl = params.ttlSeconds ?? 3600;
    const expSec = nowSec + ttl;
    const sessionId = `ses_${crypto.randomUUID()}`;

    const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'CG_JWT' }));
    const payloadObj = {
      sub: params.userId,
      usr: params.username,
      rol: params.role,
      tnt: params.tenantId,
      jti: sessionId,
      iat: nowSec,
      exp: expSec,
    };
    const payload = base64UrlEncode(JSON.stringify(payloadObj));
    const signingInput = `${header}.${payload}`;
    const signature = base64UrlEncode(
      crypto.createHmac('sha256', this.signingSecret).update(signingInput).digest()
    );

    const token = `${signingInput}.${signature}`;
    const principal: AuthenticatedPrincipal = {
      userId: params.userId,
      username: params.username,
      role: params.role,
      tenantId: params.tenantId,
      sessionId,
      issuedAt: nowSec * 1000,
      expiresAt: expSec * 1000,
      authMethod: 'SIGNED_SESSION_TOKEN',
    };

    return { token, principal };
  }

  public verifyToken(rawToken: string): AuthenticatedPrincipal | null {
    if (!rawToken || typeof rawToken !== 'string') return null;
    const trimmed = rawToken.trim();

    // Support legacy DEMO_ANALYST_TOKEN strictly in public demo mode; prohibited in enterprise mode
    if (trimmed === DEMO_ANALYST_TOKEN) {
      if (!this.isPublicDemo) {
        return null;
      }
      const now = Date.now();
      return {
        userId: 'demo_senior_analyst',
        username: 'demo.analyst@compliancegate.local',
        role: 'SENIOR_OFFICER',
        tenantId: 'default',
        sessionId: 'ses_demo_sandbox',
        issuedAt: now,
        expiresAt: now + 3600_000,
        authMethod: 'LEGACY_DEMO_TOKEN',
      };
    }

    const parts = trimmed.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;
    const expectedSig = base64UrlEncode(
      crypto.createHmac('sha256', this.signingSecret).update(signingInput).digest()
    );

    const sigBuf = Buffer.from(signatureB64, 'utf8');
    const expBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    try {
      const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
      const nowSec = Math.floor(Date.now() / 1000);
      if (typeof payload.exp !== 'number' || payload.exp < nowSec) {
        return null;
      }
      if (!payload.jti || this.revokedSessions.has(payload.jti)) {
        return null;
      }

      return {
        userId: payload.sub,
        username: payload.usr,
        role: payload.rol as UserRole,
        tenantId: payload.tnt || 'default',
        sessionId: payload.jti,
        issuedAt: (payload.iat || nowSec) * 1000,
        expiresAt: payload.exp * 1000,
        authMethod: 'SIGNED_SESSION_TOKEN',
      };
    } catch {
      return null;
    }
  }

  public revokeSession(sessionId: string): void {
    if (sessionId) {
      this.revokedSessions.add(sessionId);
    }
  }

  public hasPermission(principal: AuthenticatedPrincipal | null, permission: Permission): boolean {
    if (!principal) return false;
    const allowed = ROLE_PERMISSIONS[principal.role];
    return allowed ? allowed.has(permission) : false;
  }

  public canAccessTenant(principal: AuthenticatedPrincipal | null, resourceTenantId?: string): boolean {
    const targetTenant = resourceTenantId || 'default';
    if (!principal) return false;
    if (principal.role === 'ADMIN' && principal.tenantId === 'default') {
      return true;
    }
    return principal.tenantId === targetTenant;
  }
}

export const authService = new AuthService();

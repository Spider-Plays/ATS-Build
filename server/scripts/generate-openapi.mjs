/**
 * Generates docs/qa/openapi.yaml from structured endpoint definitions.
 * Run: node server/scripts/generate-openapi.mjs
 */
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outPath = resolve(__dirname, '../../docs/qa/openapi.yaml')

function yamlQuote(s) {
  if (/[:#\[\]{}&*!|>'"%@`]/.test(s) || s.startsWith(' ') || s.endsWith(' ')) {
    return JSON.stringify(s)
  }
  return s
}

function toYaml(obj, indent = 0) {
  const pad = '  '.repeat(indent)
  if (obj === null || obj === undefined) return `${pad}null\n`
  if (typeof obj !== 'object') {
    if (typeof obj === 'string') return `${pad}${yamlQuote(obj)}\n`
    if (typeof obj === 'boolean') return `${pad}${obj}\n`
    return `${pad}${obj}\n`
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return `${pad}[]\n`
    let out = ''
    for (const item of obj) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const keys = Object.keys(item)
        if (keys.length === 0) {
          out += `${pad}-\n`
          continue
        }
        const [first, ...rest] = keys
        const firstVal = item[first]
        if (firstVal !== null && typeof firstVal === 'object') {
          out += `${pad}-\n${toYaml({ [first]: firstVal }, indent + 1)}`
          for (const k of rest) {
            out += toYaml({ [k]: item[k] }, indent + 1)
          }
        } else {
          out += `${pad}- ${first}: ${typeof firstVal === 'string' ? yamlQuote(firstVal) : firstVal}\n`
          for (const k of rest) {
            const val = item[k]
            if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
              out += toYaml({ [k]: val }, indent + 1)
            } else if (Array.isArray(val)) {
              out += `${pad}  ${k}:\n${toYaml(val, indent + 2)}`
            } else {
              out += `${pad}  ${k}: ${typeof val === 'string' ? yamlQuote(String(val)) : val}\n`
            }
          }
        }
      } else {
        out += `${pad}- ${typeof item === 'string' ? yamlQuote(item) : item}\n`
      }
    }
    return out
  }
  let out = ''
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue
    if (val !== null && typeof val === 'object') {
      if (Array.isArray(val) && val.length === 0) {
        out += `${pad}${key}: []\n`
      } else if (Array.isArray(val)) {
        out += `${pad}${key}:\n${toYaml(val, indent + 1)}`
      } else if (Object.keys(val).length === 0) {
        out += `${pad}${key}: {}\n`
      } else {
        out += `${pad}${key}:\n${toYaml(val, indent + 1)}`
      }
    } else {
      out += `${pad}${key}: ${typeof val === 'string' ? yamlQuote(val) : val}\n`
    }
  }
  return out
}

const errorResponse = {
  description: 'Error',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
}

function op(method, summary, opts = {}) {
  const o = {
    tags: opts.tags,
    summary,
    description: opts.description,
    operationId: opts.operationId,
    security: opts.security,
    parameters: opts.parameters,
    requestBody: opts.requestBody,
    responses: {
      ...(opts.responses || { 200: { description: 'Success' } }),
      400: errorResponse,
      401: errorResponse,
      403: errorResponse,
      404: errorResponse,
      500: errorResponse,
    },
  }
  if (!opts.include503) delete o.responses[503]
  return { [method]: o }
}

function bearer(roles) {
  const sec = [{ bearerAuth: [] }]
  return { security: sec, description: roles ? `**Roles:** ${roles}` : undefined }
}

function jwtOp(method, summary, roles, opts = {}) {
  return op(method, summary, {
    ...bearer(roles),
    ...opts,
    tags: opts.tags,
    security: [{ bearerAuth: [] }],
  })
}

function ref(name) {
  return { $ref: `#/components/schemas/${name}` }
}

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Stitch ATS API',
    description: [
      'REST API for Stitch ATS — recruitment, candidate pipeline, interviews, offers, and portals.',
      '',
      '**Authentication:** JWT via `POST /api/auth/login`. Pass `Authorization: Bearer <token>` on protected routes.',
      '',
      '**Integration key:** Microsoft 365 routes use header `X-Integration-Api-Key`.',
      '',
      'See also: [API_REFERENCE.md](./API_REFERENCE.md) for QA test accounts and workflows.',
    ].join('\n'),
    version: '1.0.0',
    contact: { name: 'Stitch ATS' },
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local frontend' },
    { url: 'http://localhost:4000', description: 'Local API' },
  ],
  tags: [
    { name: 'Health', description: 'Service health and info' },
    { name: 'Auth', description: 'Login, registration, password management' },
    { name: 'Users', description: 'Staff user administration' },
    { name: 'Requirements', description: 'Job requirements / requisitions' },
    { name: 'Business Requirements', description: 'Pre-hiring client discussions and deal stages' },
    { name: 'Candidates', description: 'Candidate records and resumes' },
    { name: 'Interviews', description: 'Interview scheduling' },
    { name: 'Offers', description: 'Offer lifecycle and approvals' },
    { name: 'Feedback', description: 'Interview feedback' },
    { name: 'Activity Logs', description: 'Audit trail' },
    { name: 'Search', description: 'Global search' },
    { name: 'Candidate Portal', description: 'CANDIDATE role self-service' },
    { name: 'Careers', description: 'Public careers page (no authentication)' },
    { name: 'Vendors', description: 'Vendor management (staff)' },
    { name: 'Vendor Portal', description: 'VENDOR role self-service' },
    { name: 'Referral Portal', description: 'Employee referral self-service' },
    { name: 'Skills', description: 'Skill catalog' },
    { name: 'Departments', description: 'Department catalog' },
    { name: 'Clients', description: 'Client catalog' },
    { name: 'Role Access', description: 'Page-level role permissions' },
    { name: 'Interview Panels', description: 'Default interview panel levels' },
    { name: 'Offer Settings', description: 'Compensation and letter templates' },
    { name: 'M365 Integration', description: 'Microsoft 365 email integration (API key)' },
    { name: 'MFA', description: 'TOTP multi-factor authentication (every role except CANDIDATE)' },
    { name: 'Client Deals', description: 'Commercial deals that group business requirements' },
    { name: 'Referral Review', description: 'Staff review queue and bonuses for employee referrals' },
    { name: 'Vendor Onboarding', description: 'Staff review of vendor onboarding packets' },
    { name: 'Reports', description: 'Hiring, TA, referral and vendor reports' },
    { name: 'Change Requests', description: 'Self-service change requests' },
    { name: 'Catalogs', description: 'Cities and shared dropdown lists' },
    { name: 'Market Trends', description: 'Skill pay bands and city multipliers' },
    { name: 'Notifications', description: 'In-app notification read state' },
    { name: 'Assistant', description: 'In-app help assistant' },
    { name: 'Interview RSVP', description: 'Accept/decline links in interview emails (no login; signed token)' },
    { name: 'Workspace Admin', description: 'Developer and Super Admin controls: email delivery, backups, retention, page publication, feature flags' },
  ],
  paths: {},
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access JWT from sign-in (~15 minutes); renew with POST /api/auth/refresh' },
      integrationApiKey: { type: 'apiKey', in: 'header', name: 'X-Integration-Api-Key', description: 'M365_INTEGRATION_API_KEY env var' },
    },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'string' }, details: { type: 'object' }, code: { type: 'string' } }, required: ['error'] },
      UserRole: {
        type: 'string',
        enum: ['SUPER_ADMIN', 'DEVELOPER', 'ADMIN', 'HR_HEAD', 'TA_MANAGER', 'HUMAN_RESOURCE', 'FINANCE_HEAD', 'RECRUITER', 'TEAM_LEAD', 'HIRING_MANAGER', 'ACCOUNT_MANAGER', 'INTERVIEWER', 'CANDIDATE', 'VENDOR', 'EMPLOYEE'],
      },
      UserStatus: { type: 'string', enum: ['ACTIVE', 'DISABLED'] },
      ThemePreference: { type: 'string', enum: ['light', 'dark', 'system'] },
      User: {
        type: 'object',
        properties: {
          uid: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          role: { $ref: '#/components/schemas/UserRole' },
          tags: { type: 'array', items: { type: 'string' } },
          themePreference: { $ref: '#/components/schemas/ThemePreference' },
          createdAt: { type: 'string', format: 'date-time' },
          avatar: { type: 'string' },
          phoneNumber: { type: 'string' },
          address: { type: 'string' },
          resumeUrl: { type: 'string' },
          status: { $ref: '#/components/schemas/UserStatus' },
          authProvider: { type: 'string' },
          department: { type: 'string' },
          lastLogin: { type: 'string', format: 'date-time' },
          vendorId: { type: 'string', format: 'uuid' },
          mustChangePassword: { type: 'boolean' },
        },
      },
      Session: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'Access JWT (~15 minutes)' },
          expiresIn: { type: 'integer', description: 'Access token lifetime in seconds' },
          user: { $ref: '#/components/schemas/User' },
          allowedPages: { type: 'array', items: { type: 'string' } },
          deviceToken: { type: 'string', description: 'Only after MFA with rememberDevice: skips MFA on this device for 15 days' },
          backupCodes: { type: 'array', items: { type: 'string' }, description: 'Only after MFA enrolment: 10 one-time codes, shown once' },
        },
        required: ['token', 'user'],
      },
      MfaChallenge: {
        type: 'object',
        description: 'Returned by POST /api/auth/login instead of a session for every role except CANDIDATE when MFA is enforced.',
        properties: {
          mfaRequired: { type: 'boolean', enum: [true] },
          mfaSetupRequired: { type: 'boolean', description: 'true = user must enrol (setup/start → setup/confirm); false = verify a code' },
          mfaToken: { type: 'string', description: 'Challenge token, valid 5 minutes; cannot call other APIs' },
        },
        required: ['mfaRequired', 'mfaSetupRequired', 'mfaToken'],
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 },
          deviceToken: { type: 'string', description: 'Remembered-device token from an earlier MFA sign-in' },
        },
      },
      RegisterCandidateRequest: {
        type: 'object',
        required: ['firstName', 'lastName', 'email', 'password'],
        properties: {
          firstName: { type: 'string', minLength: 1 },
          lastName: { type: 'string', minLength: 1 },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 12 },
        },
      },
      ChangePasswordRequest: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string' },
          newPassword: { type: 'string', minLength: 12 },
        },
      },
      ForgotPasswordRequest: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } },
      ResetPasswordRequest: {
        type: 'object',
        required: ['token', 'newPassword'],
        properties: { token: { type: 'string' }, newPassword: { type: 'string', minLength: 12 } },
      },
      OkMessage: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } },
      CandidateStatus: {
        type: 'string',
        enum: ['ADDED', 'SUBMITTED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'],
      },
      RequirementStatus: {
        type: 'string',
        enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'LIVE', 'ON_HOLD', 'CLOSED', 'CANCELLED', 'REJECTED'],
      },
      HiringStage: {
        type: 'string',
        enum: ['SOURCING', 'L1_INTERVIEW', 'L2_INTERVIEW', 'HR_INTERVIEW', 'TO_BE_OFFERED', 'OFFERED', 'JOINED'],
      },
      RequirementPriority: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
      EmploymentType: { type: 'string', enum: ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'] },
      WorkMode: { type: 'string', enum: ['REMOTE', 'HYBRID', 'ONSITE'] },
      SeniorityLevel: { type: 'string', enum: ['JUNIOR', 'MID', 'SENIOR', 'LEAD', 'PRINCIPAL'] },
      OfferStatus: {
        type: 'string',
        enum: ['DRAFT', 'PENDING_HR_APPROVAL', 'PENDING_EXEC_APPROVAL', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'NEGOTIATION', 'ACCEPTED', 'DECLINED', 'WITHDRAWN'],
      },
      FeedbackRecommendation: {
        type: 'string',
        enum: ['STRONG_HIRE', 'HIRE', 'ON_HOLD', 'NO_HIRE', 'STRONG_NO_HIRE'],
      },
      InterviewStatus: { type: 'string', enum: ['SCHEDULED', 'COMPLETED', 'CANCELLED'] },
      VendorStatus: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] },
      ResumeUpload: {
        type: 'object',
        properties: { resume: { type: 'string', format: 'binary', description: 'PDF, DOC, or DOCX — max 5 MB' } },
        required: ['resume'],
      },
      Candidate: { type: 'object', description: 'Full candidate record with pipeline fields', additionalProperties: true },
      Requirement: { type: 'object', description: 'Job requirement / requisition', additionalProperties: true },
      BusinessRequirement: { type: 'object', description: 'Pre-hiring business requirement with deal stages', additionalProperties: true },
      OpenToHiringResponse: {
        type: 'object',
        properties: {
          businessRequirement: { $ref: '#/components/schemas/BusinessRequirement' },
          requirement: { $ref: '#/components/schemas/Requirement' },
        },
      },
      Interview: { type: 'object', description: 'Interview with optional enrichments', additionalProperties: true },
      Offer: { type: 'object', description: 'Offer with approval chain and letter metadata', additionalProperties: true },
      Feedback: { type: 'object', additionalProperties: true },
      ActivityLog: { type: 'object', additionalProperties: true },
      Vendor: { type: 'object', additionalProperties: true },
      InterviewPlan: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          requirementId: { type: 'string' },
          stages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                order: { type: 'integer' },
                name: { type: 'string' },
                interviewType: { type: 'string', default: 'TECHNICAL' },
                defaultDuration: { type: 'integer', default: 60 },
                defaultInterviewerIds: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      CreateUserRequest: {
        type: 'object',
        required: ['email', 'name', 'role', 'temporaryPassword'],
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string', minLength: 1 },
          role: { $ref: '#/components/schemas/UserRole' },
          department: { type: 'string', maxLength: 120 },
          phoneNumber: { type: 'string', maxLength: 40 },
          address: { type: 'string', maxLength: 500 },
          temporaryPassword: { type: 'string', minLength: 12 },
          sendInviteEmail: { type: 'boolean', default: true },
        },
      },
      CompensationConfig: {
        type: 'object',
        properties: {
          basicPercentOfCtc: { type: 'number', minimum: 1, maximum: 100 },
          hraPercentOfBasic: { type: 'number', minimum: 0, maximum: 100 },
          statBonusPercentOfBasic: { type: 'number', minimum: 0, maximum: 100 },
          ltaPercentOfBasic: { type: 'number', minimum: 0, maximum: 100 },
          mealAllowanceAnnual: { type: 'number', minimum: 0 },
          mobileAllowanceAnnual: { type: 'number', minimum: 0 },
          siteAllowanceAnnual: { type: 'number', minimum: 0 },
          employerPfPercentOfBasic: { type: 'number', minimum: 0, maximum: 100 },
          pfAdminPercentOfBasic: { type: 'number', minimum: 0, maximum: 100 },
          insuranceAnnual: { type: 'number', minimum: 0 },
          employerLwfAnnual: { type: 'number', minimum: 0 },
          employeeLwfAnnual: { type: 'number', minimum: 0 },
        },
      },
    },
  },
}

const p = spec.paths

// Health
p['/'] = op('get', 'Service info', { tags: ['Health'], security: [], responses: { 200: { description: 'Service metadata' } } })
p['/api/health'] = op('get', 'Health check', {
  tags: ['Health'],
  security: [],
  responses: {
    200: { description: 'Healthy', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, database: { type: 'string' }, buildId: { type: 'string' }, email: { type: 'string' } } } } } },
    503: { description: 'Database unavailable', content: { 'application/json': { schema: ref('Error') } } },
  },
  include503: true,
})

// Auth
p['/api/auth/register-candidate'] = op('post', 'Register candidate account', {
  tags: ['Auth'],
  security: [],
  requestBody: { required: true, content: { 'application/json': { schema: ref('RegisterCandidateRequest') } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: ref('Session') } } }, 409: errorResponse },
})
p['/api/auth/login'] = op('post', 'Password sign-in (all portals)', {
  tags: ['Auth'],
  security: [],
  description: 'Candidates get a session. Every other role gets an MFA challenge unless `deviceToken` is a remembered device. 5 wrong passwords lock the account (423 `ACCOUNT_LOCKED`).',
  requestBody: { required: true, content: { 'application/json': { schema: ref('LoginRequest') } } },
  responses: {
    200: { description: 'Session, or MFA challenge', content: { 'application/json': { schema: { oneOf: [ref('Session'), ref('MfaChallenge')] } } } },
    423: errorResponse,
    429: errorResponse,
  },
})
p['/api/auth/me'] = jwtOp('get', 'Current user profile', 'Any active user', {
  tags: ['Auth'],
  operationId: 'getAuthMe',
  responses: { 200: { description: 'User + allowedPages + optional refreshed token', content: { 'application/json': { schema: { allOf: [ref('User'), { type: 'object', properties: { allowedPages: { type: 'array', items: { type: 'string' } }, token: { type: 'string' } } }] } } } } },
})
p['/api/auth/change-password'] = jwtOp('post', 'Change password', 'Any active user', {
  tags: ['Auth'],
  requestBody: { required: true, content: { 'application/json': { schema: ref('ChangePasswordRequest') } } },
  responses: { 200: { description: 'New session', content: { 'application/json': { schema: ref('Session') } } } },
})
p['/api/auth/forgot-password'] = op('post', 'Request password reset email', {
  tags: ['Auth'],
  security: [],
  description: 'Rate-limited. Always returns 200 to avoid email enumeration.',
  requestBody: { required: true, content: { 'application/json': { schema: ref('ForgotPasswordRequest') } } },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: ref('OkMessage') } } }, 429: { description: 'Rate limited' } },
})
p['/api/auth/reset-password'] = op('post', 'Reset password with token', {
  tags: ['Auth'],
  security: [],
  description: 'Rate-limited.',
  requestBody: { required: true, content: { 'application/json': { schema: ref('ResetPasswordRequest') } } },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: ref('OkMessage') } } } },
})

// Users
p['/api/users'] = {
  ...jwtOp('get', 'List users', 'ADMIN, HR_HEAD, TA_MANAGER, RECRUITER, TEAM_LEAD, HIRING_MANAGER, INTERVIEWER', {
    tags: ['Users'],
    responses: { 200: { description: 'User array', content: { 'application/json': { schema: { type: 'array', items: ref('User') } } } } },
  }),
  ...jwtOp('post', 'Create staff user', 'SUPER_ADMIN, ADMIN', {
    tags: ['Users'],
    requestBody: { required: true, content: { 'application/json': { schema: ref('CreateUserRequest') } } },
    responses: { 201: { description: 'Created user', content: { 'application/json': { schema: { type: 'object', properties: { user: ref('User'), inviteEmailSent: { type: 'boolean' } } } } } }, 409: errorResponse },
  }),
}
p['/api/users/me'] = jwtOp('patch', 'Update own profile', 'Any authenticated user', {
  tags: ['Users'],
  requestBody: {
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            phoneNumber: { type: 'string' },
            address: { type: 'string' },
            themePreference: ref('ThemePreference'),
            avatar: { type: 'string', format: 'uri' },
          },
        },
      },
    },
  },
  responses: { 200: { description: 'Updated user', content: { 'application/json': { schema: ref('User') } } } },
})
p['/api/users/{id}'] = {
  ...jwtOp('get', 'Get user by ID', 'SUPER_ADMIN', {
    tags: ['Users'],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: { 200: { description: 'User', content: { 'application/json': { schema: ref('User') } } } },
  }),
  ...jwtOp('patch', 'Update user', 'SUPER_ADMIN', {
    tags: ['Users'],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, department: { type: 'string', nullable: true }, phoneNumber: { type: 'string', nullable: true }, address: { type: 'string', nullable: true } } } } } },
    responses: { 200: { description: 'Updated', content: { 'application/json': { schema: ref('User') } } } },
  }),
  ...jwtOp('delete', 'Delete user', 'SUPER_ADMIN', {
    tags: ['Users'],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: { 204: { description: 'Deleted' } },
  }),
}
p['/api/users/{id}/login-history'] = jwtOp('get', 'User login history', 'SUPER_ADMIN', {
  tags: ['Users'],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  responses: { 200: { description: 'Login events', content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, userId: { type: 'string' }, loggedInAt: { type: 'string', format: 'date-time' }, ipAddress: { type: 'string' }, userAgent: { type: 'string' } } } } } } } },
})
p['/api/users/{id}/send-password-reset-link'] = jwtOp('post', 'Email password reset link', 'SUPER_ADMIN', {
  tags: ['Users'],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: ref('OkMessage') } } } },
})
p['/api/users/{id}/reset-password'] = jwtOp('post', 'Admin reset password', 'SUPER_ADMIN', {
  tags: ['Users'],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { newPassword: { type: 'string', minLength: 12 }, generateTemporary: { type: 'boolean' } } } } } },
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, temporaryPassword: { type: 'string' }, message: { type: 'string' } } } } } } },
})
p['/api/users/{id}/tags'] = jwtOp('patch', 'Set user feature tags', 'SUPER_ADMIN', {
  tags: ['Users'],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['tags'], properties: { tags: { type: 'array', items: { type: 'string' } } } } } } },
  responses: { 200: { description: 'Updated', content: { 'application/json': { schema: ref('User') } } } },
})
p['/api/users/{id}/role'] = jwtOp('patch', 'Change user role', 'SUPER_ADMIN', {
  tags: ['Users'],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['role'], properties: { role: ref('UserRole') } } } } },
  responses: { 200: { description: 'Updated', content: { 'application/json': { schema: ref('User') } } } },
})
p['/api/users/{id}/status'] = jwtOp('patch', 'Enable or disable user', 'SUPER_ADMIN', {
  tags: ['Users'],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: ref('UserStatus') } } } } },
  responses: { 200: { description: 'Updated', content: { 'application/json': { schema: ref('User') } } } },
})

// Helper to add remaining paths in bulk
function addPaths(entries) {
  for (const [path, methods] of entries) {
    if (!p[path]) p[path] = {}
    Object.assign(p[path], methods)
  }
}

const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
const jsonBody = (schema) => ({ required: true, content: { 'application/json': { schema } } })
// Duplicate lookups are POST so emails and PANs never appear in URLs or access logs.
const emailLookupBody = jsonBody({ type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' }, excludeId: { type: 'string' } } })
const panLookupBody = jsonBody({ type: 'object', required: ['pan'], properties: { pan: { type: 'string' }, excludeId: { type: 'string' } } })
const arrResp = (itemRef, desc = 'Array') => ({ description: desc, content: { 'application/json': { schema: { type: 'array', items: ref(itemRef) } } } })
const objResp = (itemRef, desc = 'Object') => ({ description: desc, content: { 'application/json': { schema: ref(itemRef) } } })

addPaths([
  ['/api/business-requirements', {
    get: jwtOp('get', 'List business requirements', 'ACCOUNT_MANAGER, HIRING_MANAGER, ADMIN', { tags: ['Business Requirements'], responses: { 200: arrResp('BusinessRequirement') } }).get,
    post: jwtOp('post', 'Create business requirement', 'ACCOUNT_MANAGER, HIRING_MANAGER, ADMIN', {
      tags: ['Business Requirements'],
      requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
      responses: { 201: objResp('BusinessRequirement') },
    }).post,
  }],
  ['/api/business-requirements/{id}', {
    get: jwtOp('get', 'Get business requirement', 'Mutate roles + HR_HEAD/TA_MANAGER preview', { tags: ['Business Requirements'], parameters: [idParam], responses: { 200: objResp('BusinessRequirement') } }).get,
    patch: jwtOp('patch', 'Update business requirement', 'ACCOUNT_MANAGER, HIRING_MANAGER, ADMIN', { tags: ['Business Requirements'], parameters: [idParam], requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }, responses: { 200: objResp('BusinessRequirement') } }).patch,
  }],
  ['/api/business-requirements/{id}/stage', {
    patch: jwtOp('patch', 'Update business stage', 'ACCOUNT_MANAGER, HIRING_MANAGER, ADMIN', {
      tags: ['Business Requirements'],
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', required: ['businessStage'], properties: { businessStage: { type: 'string', enum: ['INITIAL_DISCUSSION', 'PROPOSAL_SENT', 'NEGOTIATION', 'SOW_SIGNED', 'CONFIRMED'] } } }),
      responses: { 200: objResp('BusinessRequirement') },
    }).patch,
  }],
  ['/api/business-requirements/{id}/open-to-hiring', {
    post: jwtOp('post', 'Open to hiring', 'Creates PENDING_APPROVAL Requirement', {
      tags: ['Business Requirements'],
      parameters: [idParam],
      responses: { 201: objResp('OpenToHiringResponse') },
    }).post,
  }],
  ['/api/business-requirements/{id}/activity-logs', {
    get: jwtOp('get', 'Business requirement activity logs', 'Mutate roles + HR_HEAD/TA_MANAGER preview', {
      tags: ['Business Requirements'],
      parameters: [idParam, { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }],
      responses: { 200: arrResp('ActivityLog') },
    }).get,
  }],
  ['/api/business-requirements/{id}/cancel', {
    post: jwtOp('post', 'Cancel business requirement', 'ACCOUNT_MANAGER, HIRING_MANAGER, ADMIN', {
      tags: ['Business Requirements'],
      parameters: [idParam],
      responses: { 200: objResp('BusinessRequirement') },
    }).post,
  }],
  ['/api/requirements', {
    get: jwtOp('get', 'List requirements', 'Internal (scoped)', { tags: ['Requirements'], responses: { 200: arrResp('Requirement') } }).get,
    post: jwtOp('post', 'Create requirement', 'Staff mutate + HIRING_MANAGER', {
      tags: ['Requirements'],
      description: 'Required: title, department, hiringManager, openings, priority, client, primarySkills, secondarySkills',
      requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
      responses: { 201: objResp('Requirement') },
    }).post,
  }],
  ['/api/requirements/pending', { get: jwtOp('get', 'Pending approval requirements', 'Internal', { tags: ['Requirements'], responses: { 200: arrResp('Requirement') } }).get }],
  ['/api/requirements/parse-job-description', {
    post: jwtOp('post', 'Parse job description', 'Staff mutate + HIRING_MANAGER', {
      tags: ['Requirements'],
      requestBody: {
        content: {
          'multipart/form-data': { schema: ref('ResumeUpload') },
          'application/json': { schema: { type: 'object', properties: { jobDescription: { type: 'string', minLength: 20 } } } },
        },
      },
      responses: { 200: { description: 'Parsed skills', content: { 'application/json': { schema: { type: 'object', properties: { jobDescription: { type: 'string' }, primarySkills: { type: 'array', items: { type: 'string' } }, secondarySkills: { type: 'array', items: { type: 'string' } } } } } } }, 422: errorResponse },
    }).post,
  }],
  ['/api/requirements/{id}', {
    get: jwtOp('get', 'Get requirement', 'Internal + access', { tags: ['Requirements'], parameters: [idParam], responses: { 200: objResp('Requirement') } }).get,
    patch: jwtOp('patch', 'Update requirement', 'Staff mutate + HIRING_MANAGER', { tags: ['Requirements'], parameters: [idParam], requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }, responses: { 200: objResp('Requirement') } }).patch,
    delete: jwtOp('delete', 'Delete requirement', 'ADMIN', { tags: ['Requirements'], parameters: [idParam], responses: { 204: { description: 'Deleted' } } }).delete,
  }],
  ['/api/requirements/{id}/matching-profiles', {
    get: jwtOp('get', 'Matching candidate profiles', 'Internal + access', {
      tags: ['Requirements'],
      parameters: [idParam, { name: 'minScore', in: 'query', schema: { type: 'integer', default: 15 } }],
      responses: { 200: { description: 'Matches', content: { 'application/json': { schema: { type: 'object', properties: { matches: { type: 'array', items: ref('Candidate') }, totalCandidates: { type: 'integer' } } } } } } },
    }).get,
  }],
  ['/api/requirements/{id}/link-candidate', {
    post: jwtOp('post', 'Link candidate to requirement', 'Staff mutate', {
      tags: ['Requirements'],
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', required: ['candidateId'], properties: { candidateId: { type: 'string', format: 'uuid' } } }),
      responses: { 200: objResp('Candidate') },
    }).post,
  }],
  ['/api/requirements/{id}/interview-plan', {
    get: jwtOp('get', 'Get interview plan', 'Internal + access', { tags: ['Requirements'], parameters: [idParam], responses: { 200: objResp('InterviewPlan') } }).get,
    put: jwtOp('put', 'Replace interview plan', 'Interview plan editors', {
      tags: ['Requirements'],
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', required: ['stages'], properties: { stages: { type: 'array', minItems: 1, items: { type: 'object', required: ['name'], properties: { id: { type: 'string' }, name: { type: 'string' }, interviewType: { type: 'string' }, defaultDuration: { type: 'integer' }, defaultInterviewerIds: { type: 'array', items: { type: 'string' } } } } } } }),
      responses: { 200: objResp('InterviewPlan') },
    }).put,
  }],
  ['/api/requirements/{id}/interview-plan/candidate/{candidateId}/progress', {
    get: jwtOp('get', 'Candidate stage progress', 'Internal + access', {
      tags: ['Requirements'],
      parameters: [idParam, { name: 'candidateId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Stage progress' } },
    }).get,
  }],
  ['/api/requirements/{id}/status', {
    patch: jwtOp('patch', 'Update requirement status', 'Posting control', {
      tags: ['Requirements'],
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', required: ['status'], properties: { status: ref('RequirementStatus') } }),
      responses: { 200: objResp('Requirement') },
    }).patch,
  }],
  ['/api/requirements/{id}/hiring-stage', {
    patch: jwtOp('patch', 'Update hiring stage', 'RECRUITER, TA_MANAGER, TEAM_LEAD', {
      tags: ['Requirements'],
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', required: ['hiringStage'], properties: { hiringStage: ref('HiringStage') } }),
      responses: { 200: objResp('Requirement') },
    }).patch,
  }],
  ['/api/requirements/{id}/cancel', {
    post: jwtOp('post', 'Cancel requirement', 'Posting control', {
      tags: ['Requirements'],
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', required: ['closureReason'], properties: { closureReason: { type: 'string', minLength: 3 }, closedAt: { type: 'string', format: 'date-time' } } }),
      responses: { 200: objResp('Requirement') },
    }).post,
  }],
  ['/api/requirements/{id}/visibility', {
    patch: jwtOp('patch', 'Set candidate portal visibility', 'Portal visibility roles', {
      tags: ['Requirements'],
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', required: ['visibleToCandidates'], properties: { visibleToCandidates: { type: 'boolean' } } }),
      responses: { 200: objResp('Requirement') },
    }).patch,
  }],
  ['/api/requirements/{id}/referral-visibility', {
    patch: jwtOp('patch', 'Set referral portal visibility', 'Portal visibility roles', {
      tags: ['Requirements'],
      parameters: [idParam],
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { visibleToReferrals: { type: 'boolean' }, referralBonusAmount: { type: 'number', minimum: 0 } } } } } },
      responses: { 200: objResp('Requirement') },
    }).patch,
  }],
  ['/api/requirements/{id}/approve', {
    post: jwtOp('post', 'Approve requirement', 'HR_HEAD, SUPER_ADMIN, ADMIN', {
      tags: ['Requirements'],
      parameters: [idParam],
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { onBehalfOfHrHead: { type: 'boolean' } } } } } },
      responses: { 200: objResp('Requirement') },
    }).post,
  }],
  ['/api/requirements/{id}/reject', {
    post: jwtOp('post', 'Reject requirement', 'HR_HEAD, SUPER_ADMIN, ADMIN', {
      tags: ['Requirements'],
      parameters: [idParam],
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { onBehalfOfHrHead: { type: 'boolean' } } } } } },
      responses: { 200: objResp('Requirement') },
    }).post,
  }],
  ['/api/requirements/{id}/assign-recruiter', {
    post: jwtOp('post', 'Assign recruiter', 'Staff mutate', {
      tags: ['Requirements'],
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', required: ['recruiterId'], properties: { recruiterId: { type: 'string', format: 'uuid' } } }),
      responses: { 200: objResp('Requirement') },
    }).post,
  }],
  ['/api/requirements/{id}/assign-recruiter/{recruiterId}', {
    delete: jwtOp('delete', 'Unassign recruiter', 'Staff mutate', {
      tags: ['Requirements'],
      parameters: [idParam, { name: 'recruiterId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: objResp('Requirement') },
    }).delete,
  }],
])

// Candidates
addPaths([
  ['/api/candidates', {
    get: jwtOp('get', 'List candidates', 'Internal (INTERVIEWER blocked)', { tags: ['Candidates'], responses: { 200: arrResp('Candidate') } }).get,
    post: jwtOp('post', 'Create candidate', 'Staff mutate', {
      tags: ['Candidates'],
      requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['email'], additionalProperties: true } } } },
      responses: { 201: objResp('Candidate') },
    }).post,
  }],
  ['/api/candidates/by-requirement/{requirementId}', {
    get: jwtOp('get', 'Candidates by requirement', 'Internal + access', {
      tags: ['Candidates'],
      parameters: [{ name: 'requirementId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: arrResp('Candidate') },
    }).get,
  }],
  ['/api/candidates/parse-resume', {
    post: jwtOp('post', 'Parse resume file', 'Staff mutate', {
      tags: ['Candidates'],
      requestBody: { required: true, content: { 'multipart/form-data': { schema: ref('ResumeUpload') } } },
      responses: { 200: { description: 'Extracted fields', content: { 'application/json': { schema: { type: 'object', properties: { fields: { type: 'object', additionalProperties: true } } } } } }, 422: errorResponse },
    }).post,
  }],
  ['/api/candidates/check-email', {
    post: jwtOp('post', 'Check if email exists', 'Internal', {
      tags: ['Candidates'],
      requestBody: emailLookupBody,
      responses: { 200: { description: 'Existence check' } },
    }).post,
  }],
  ['/api/candidates/{id}', {
    get: jwtOp('get', 'Get candidate', 'Internal + access', { tags: ['Candidates'], parameters: [idParam], responses: { 200: objResp('Candidate') } }).get,
    patch: jwtOp('patch', 'Update candidate', 'Staff mutate', { tags: ['Candidates'], parameters: [idParam], requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }, responses: { 200: objResp('Candidate') } }).patch,
    delete: jwtOp('delete', 'Delete candidate', 'ADMIN', { tags: ['Candidates'], parameters: [idParam], responses: { 204: { description: 'Deleted' } } }).delete,
  }],
  ['/api/candidates/{id}/resume', {
    get: jwtOp('get', 'Download resume', 'Internal + access', { tags: ['Candidates'], parameters: [idParam], responses: { 200: { description: 'PDF/DOC binary', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } } } }).get,
    post: jwtOp('post', 'Upload resume', 'Staff mutate', { tags: ['Candidates'], parameters: [idParam], requestBody: { required: true, content: { 'multipart/form-data': { schema: ref('ResumeUpload') } } }, responses: { 200: objResp('Candidate') } }).post,
    delete: jwtOp('delete', 'Remove resume', 'Internal + access', { tags: ['Candidates'], parameters: [idParam], responses: { 200: objResp('Candidate') } }).delete,
  }],
  ['/api/candidates/{id}/status', {
    patch: jwtOp('patch', 'Update candidate status', 'Staff mutate', {
      tags: ['Candidates'],
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', required: ['status'], properties: { status: ref('CandidateStatus'), milestone: { type: 'object', additionalProperties: true } } }),
      responses: { 200: objResp('Candidate') },
    }).patch,
  }],
  ['/api/candidates/{id}/send-jd', {
    post: jwtOp('post', 'Email job description to candidate', 'Staff mutate', {
      tags: ['Candidates'],
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', required: ['requirementId'], properties: { requirementId: { type: 'string' } } }),
      responses: { 200: { description: 'Email queued or sent' } },
    }).post,
  }],
])

// Interviews
addPaths([
  ['/api/interviews', {
    get: jwtOp('get', 'List interviews', 'Internal (scoped)', { tags: ['Interviews'], responses: { 200: arrResp('Interview') } }).get,
    post: jwtOp('post', 'Schedule interview', 'Interview schedulers', {
      tags: ['Interviews'],
      requestBody: jsonBody({
        type: 'object',
        required: ['requirementId', 'candidateId', 'planStageId', 'scheduledAt', 'interviewerIds'],
        properties: {
          requirementId: { type: 'string' },
          candidateId: { type: 'string' },
          planStageId: { type: 'string' },
          scheduledAt: { type: 'string', format: 'date-time' },
          interviewerIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
          type: { type: 'string' },
          status: ref('InterviewStatus'),
          meetingLink: { type: 'string' },
          duration: { type: 'integer' },
          location: { type: 'string' },
          description: { type: 'string' },
        },
      }),
      responses: { 201: objResp('Interview') },
    }).post,
  }],
  ['/api/interviews/by-candidate/{candidateId}', {
    get: jwtOp('get', 'Interviews by candidate', 'Internal + access', {
      tags: ['Interviews'],
      parameters: [{ name: 'candidateId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: arrResp('Interview') },
    }).get,
  }],
  ['/api/interviews/{id}', {
    get: jwtOp('get', 'Get interview', 'Internal + access', { tags: ['Interviews'], parameters: [idParam], responses: { 200: objResp('Interview') } }).get,
    patch: jwtOp('patch', 'Update interview', 'Interview schedulers', { tags: ['Interviews'], parameters: [idParam], requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }, responses: { 200: objResp('Interview') } }).patch,
    delete: jwtOp('delete', 'Delete interview', 'ADMIN', { tags: ['Interviews'], parameters: [idParam], responses: { 204: { description: 'Deleted' } } }).delete,
  }],
  ['/api/interviews/{id}/candidate-resume', {
    get: jwtOp('get', 'Download candidate resume for interview', 'Internal + access', {
      tags: ['Interviews'],
      parameters: [idParam],
      responses: { 200: { description: 'Resume binary', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } } },
    }).get,
  }],
  ['/api/interviews/{id}/status', {
    patch: jwtOp('patch', 'Update interview status', 'Interview schedulers', {
      tags: ['Interviews'],
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', required: ['status'], properties: { status: ref('InterviewStatus') } }),
      responses: { 200: objResp('Interview') },
    }).patch,
  }],
])

// Offers
const offerIdParam = [idParam]
const offerRoles = 'Offer roles (SUPER_ADMIN, ADMIN, HR_HEAD, TA_MANAGER, RECRUITER, TEAM_LEAD)'
addPaths([
  ['/api/offers', {
    get: jwtOp('get', 'List offers', offerRoles, { tags: ['Offers'], responses: { 200: arrResp('Offer') } }).get,
    post: jwtOp('post', 'Create offer draft', offerRoles, {
      tags: ['Offers'],
      requestBody: jsonBody({ type: 'object', required: ['candidateId', 'requirementId'], properties: { candidateId: { type: 'string' }, requirementId: { type: 'string' }, annualCtc: { type: 'number' }, letterMeta: { type: 'object' }, approvalChain: { type: 'object' } } }),
      responses: { 201: objResp('Offer') },
    }).post,
  }],
  ['/api/offers/pending', {
    get: jwtOp('get', 'Pending approvals', offerRoles, {
      tags: ['Offers'],
      parameters: [{ name: 'step', in: 'query', schema: { type: 'string', enum: ['exec', 'chain'] }, description: 'Filter: exec or chain approvers; default HR pending' }],
      responses: { 200: arrResp('Offer') },
    }).get,
  }],
  ['/api/offers/preview-compensation', {
    post: jwtOp('post', 'Preview compensation breakdown', offerRoles, {
      tags: ['Offers'],
      requestBody: jsonBody({ type: 'object', properties: { annualCtc: { type: 'number', minimum: 1000 } } }),
      responses: { 200: { description: 'Compensation breakdown' } },
    }).post,
  }],
  ['/api/offers/by-candidate/{candidateId}', {
    get: jwtOp('get', 'Offers by candidate', offerRoles, {
      tags: ['Offers'],
      parameters: [{ name: 'candidateId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: arrResp('Offer') },
    }).get,
  }],
  ['/api/offers/{id}', {
    get: jwtOp('get', 'Get offer', offerRoles, { tags: ['Offers'], parameters: offerIdParam, responses: { 200: objResp('Offer') } }).get,
    patch: jwtOp('patch', 'Update offer', offerRoles, { tags: ['Offers'], parameters: offerIdParam, requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }, responses: { 200: objResp('Offer') } }).patch,
    delete: jwtOp('delete', 'Delete offer', 'ADMIN', { tags: ['Offers'], parameters: offerIdParam, responses: { 204: { description: 'Deleted' } } }).delete,
  }],
  ['/api/offers/{id}/letter', { get: jwtOp('get', 'Offer letter HTML', offerRoles, { tags: ['Offers'], parameters: offerIdParam, responses: { 200: { description: 'HTML', content: { 'text/html': { schema: { type: 'string' } } } } } }).get }],
  ['/api/offers/{id}/letter/pdf', { get: jwtOp('get', 'Offer letter PDF', offerRoles, { tags: ['Offers'], parameters: offerIdParam, responses: { 200: { description: 'PDF', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } } } }).get }],
  ['/api/offers/{id}/submit', { post: jwtOp('post', 'Submit for approval', offerRoles, { tags: ['Offers'], parameters: offerIdParam, responses: { 200: objResp('Offer') } }).post }],
  ['/api/offers/{id}/approve-hr', { post: jwtOp('post', 'HR approval', 'HR_HEAD, SUPER_ADMIN, ADMIN', { tags: ['Offers'], parameters: offerIdParam, requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { comment: { type: 'string' }, reason: { type: 'string' }, onBehalfOfHrHead: { type: 'boolean' } }, required: ['comment'] } } } }, responses: { 200: objResp('Offer') } }).post }],
  ['/api/offers/{id}/approve-exec', { post: jwtOp('post', 'Executive approval', 'SUPER_ADMIN, ADMIN', { tags: ['Offers'], parameters: offerIdParam, requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { comment: { type: 'string' }, reason: { type: 'string' }, onBehalfOfExec: { type: 'boolean' } }, required: ['comment'] } } } }, responses: { 200: objResp('Offer') } }).post }],
  ['/api/offers/{id}/approve-stage', { post: jwtOp('post', 'Chain stage approval', 'Internal', { tags: ['Offers'], parameters: offerIdParam, requestBody: jsonBody({ type: 'object', required: ['comment'], properties: { comment: { type: 'string' } } }), responses: { 200: objResp('Offer') } }).post }],
  ['/api/offers/{id}/reject', { post: jwtOp('post', 'Reject offer', 'Approvers + Internal', { tags: ['Offers'], parameters: offerIdParam, requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string' }, comment: { type: 'string' } } } } } }, responses: { 200: objResp('Offer') } }).post }],
  ['/api/offers/{id}/rollback-approval', { post: jwtOp('post', 'Rollback approval', 'SUPER_ADMIN', { tags: ['Offers'], parameters: offerIdParam, requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string' } } } } } }, responses: { 200: objResp('Offer') } }).post }],
  ['/api/offers/{id}/send', { post: jwtOp('post', 'Send offer to candidate', offerRoles, { tags: ['Offers'], parameters: offerIdParam, responses: { 200: objResp('Offer') } }).post }],
  ['/api/offers/{id}/withdraw', { post: jwtOp('post', 'Withdraw offer', offerRoles, { tags: ['Offers'], parameters: offerIdParam, responses: { 200: objResp('Offer') } }).post }],
  ['/api/offers/{id}/negotiate', { post: jwtOp('post', 'Mark negotiation', offerRoles, { tags: ['Offers'], parameters: offerIdParam, responses: { 200: objResp('Offer') } }).post }],
  ['/api/offers/{id}/revise', { post: jwtOp('post', 'Revise offer', offerRoles, { tags: ['Offers'], parameters: offerIdParam, responses: { 200: objResp('Offer') } }).post }],
  ['/api/offers/{id}/accept', { post: jwtOp('post', 'Staff accept on behalf', offerRoles, { tags: ['Offers'], parameters: offerIdParam, responses: { 200: objResp('Offer') } }).post }],
  ['/api/offers/{id}/decline', { post: jwtOp('post', 'Staff decline on behalf', offerRoles, { tags: ['Offers'], parameters: offerIdParam, responses: { 200: objResp('Offer') } }).post }],
])

// Feedback, Activity, Search
addPaths([
  ['/api/feedback', {
    post: jwtOp('post', 'Submit feedback', 'Internal', {
      tags: ['Feedback'],
      requestBody: jsonBody({
        type: 'object',
        required: ['interviewId', 'candidateId'],
        properties: {
          interviewId: { type: 'string' },
          candidateId: { type: 'string' },
          interviewerId: { type: 'string' },
          rating: { type: 'number' },
          technicalRating: { type: 'number' },
          communicationRating: { type: 'number' },
          comments: { type: 'string' },
          recommendation: ref('FeedbackRecommendation'),
          formData: { type: 'object' },
        },
      }),
      responses: { 201: objResp('Feedback') },
    }).post,
  }],
  ['/api/feedback/by-interview/{interviewId}', { get: jwtOp('get', 'Feedback by interview', 'Internal + access', { tags: ['Feedback'], parameters: [{ name: 'interviewId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: arrResp('Feedback') } }).get }],
  ['/api/feedback/by-candidate/{candidateId}', { get: jwtOp('get', 'Feedback by candidate', 'Internal + access', { tags: ['Feedback'], parameters: [{ name: 'candidateId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: arrResp('Feedback') } }).get }],
  ['/api/feedback/{id}', {
    get: jwtOp('get', 'Get feedback', 'Internal + access', { tags: ['Feedback'], parameters: [idParam], responses: { 200: objResp('Feedback') } }).get,
    delete: jwtOp('delete', 'Delete feedback', 'ADMIN', { tags: ['Feedback'], parameters: [idParam], responses: { 204: { description: 'Deleted' } } }).delete,
  }],
  ['/api/feedback/{id}/download', { get: jwtOp('get', 'Download feedback HTML', 'Internal + access', { tags: ['Feedback'], parameters: [idParam], responses: { 200: { description: 'HTML attachment', content: { 'text/html': { schema: { type: 'string' } } } } } }).get }],
  ['/api/activity-logs', {
    get: jwtOp('get', 'Recent activity logs', 'Internal', { tags: ['Activity Logs'], parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } }], responses: { 200: arrResp('ActivityLog') } }).get,
  }],
  ['/api/activity-logs/entity/{entityId}', {
    get: jwtOp('get', 'Logs for entity', 'Internal', {
      tags: ['Activity Logs'],
      parameters: [{ name: 'entityId', in: 'path', required: true, schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }],
      responses: { 200: arrResp('ActivityLog') },
    }).get,
  }],
  ['/api/search', {
    get: jwtOp('get', 'Global search', 'Internal', {
      tags: ['Search'],
      parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2 } }],
      responses: {
        200: {
          description: 'Search results',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  candidates: { type: 'array', items: ref('Candidate') },
                  requirements: { type: 'array', items: ref('Requirement') },
                  users: { type: 'array', items: ref('User') },
                  interviews: { type: 'array', items: ref('Interview') },
                },
              },
            },
          },
        },
      },
    }).get,
  }],
])

// Portals
const candidateOnly = 'CANDIDATE'
addPaths([
  ['/api/portal/profile', { put: jwtOp('put', 'Update candidate profile', candidateOnly, { tags: ['Candidate Portal'], requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }, responses: { 200: { description: 'Profile update result' } } }).put }],
  ['/api/portal/profile/resume', { post: jwtOp('post', 'Upload profile resume', candidateOnly, { tags: ['Candidate Portal'], requestBody: { required: true, content: { 'multipart/form-data': { schema: ref('ResumeUpload') } } }, responses: { 200: { description: 'Updated profile' } } }).post }],
  ['/api/portal/positions', { get: jwtOp('get', 'Open positions', candidateOnly, { tags: ['Candidate Portal'], responses: { 200: { description: 'Position list' } } }).get }],
  ['/api/portal/positions/{id}', { get: jwtOp('get', 'Position detail', candidateOnly, { tags: ['Candidate Portal'], parameters: [idParam], responses: { 200: { description: 'Position' } } }).get }],
  ['/api/portal/positions/{id}/apply', { post: jwtOp('post', 'Apply to position', candidateOnly, { tags: ['Candidate Portal'], parameters: [idParam], responses: { 201: { description: 'Application created' } } }).post }],
  ['/api/portal/applications', { get: jwtOp('get', 'My applications', candidateOnly, { tags: ['Candidate Portal'], responses: { 200: { description: 'Applications' } } }).get }],
  ['/api/portal/applications/{requirementId}', { get: jwtOp('get', 'Application detail', candidateOnly, { tags: ['Candidate Portal'], parameters: [{ name: 'requirementId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Application with interviews and offers' } } }).get }],
  ['/api/portal/me', { get: jwtOp('get', 'Candidate dashboard', candidateOnly, { tags: ['Candidate Portal'], responses: { 200: { description: 'Dashboard' } } }).get }],
  ['/api/portal/offers/{id}', { get: jwtOp('get', 'View offer', candidateOnly, { tags: ['Candidate Portal'], parameters: [idParam], responses: { 200: objResp('Offer') } }).get }],
  ['/api/portal/offers/{id}/letter/pdf', { get: jwtOp('get', 'Download offer letter PDF', candidateOnly, { tags: ['Candidate Portal'], parameters: [idParam], responses: { 200: { description: 'PDF', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } } } }).get }],
  ['/api/portal/offers/{id}/accept', { post: jwtOp('post', 'Accept offer', candidateOnly, { tags: ['Candidate Portal'], parameters: [idParam], responses: { 200: objResp('Offer') } }).post }],
  ['/api/portal/offers/{id}/decline', { post: jwtOp('post', 'Decline offer', candidateOnly, { tags: ['Candidate Portal'], parameters: [idParam], responses: { 200: objResp('Offer') } }).post }],
])

addPaths([
  ['/api/careers/positions', { get: op('get', 'Public open positions', { tags: ['Careers'], security: [], description: '**Public** — no authentication required', responses: { 200: { description: 'Position list' } } }).get }],
  ['/api/careers/positions/departments', { get: op('get', 'Public position departments', { tags: ['Careers'], security: [], description: '**Public** — no authentication required', responses: { 200: { description: 'Department names' } } }).get }],
  ['/api/careers/positions/{id}', { get: op('get', 'Public position detail', { tags: ['Careers'], security: [], description: '**Public** — no authentication required', parameters: [idParam], responses: { 200: { description: 'Position' } } }).get }],
])

const vendorOnly = 'VENDOR'
addPaths([
  ['/api/vendors', {
    get: jwtOp('get', 'List vendors', 'Vendor managers', { tags: ['Vendors'], responses: { 200: arrResp('Vendor') } }).get,
    post: jwtOp('post', 'Create vendor', 'Vendor managers', { tags: ['Vendors'], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['name', 'email'], additionalProperties: true } } } }, responses: { 201: { description: 'Created vendor' } } }).post,
  }],
  ['/api/vendors/{id}', {
    get: jwtOp('get', 'Get vendor', 'Vendor managers', { tags: ['Vendors'], parameters: [idParam], responses: { 200: objResp('Vendor') } }).get,
    patch: jwtOp('patch', 'Update vendor', 'Vendor managers', { tags: ['Vendors'], parameters: [idParam], requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }, responses: { 200: objResp('Vendor') } }).patch,
  }],
  ['/api/vendors/{id}/assignments', { post: jwtOp('post', 'Assign requirements', 'Vendor managers', { tags: ['Vendors'], parameters: [idParam], requestBody: jsonBody({ type: 'object', required: ['requirementIds'], properties: { requirementIds: { type: 'array', items: { type: 'string' } } } }), responses: { 200: { description: 'Assigned IDs' } } }).post }],
  ['/api/vendors/{id}/assignments/{requirementId}', { delete: jwtOp('delete', 'Remove assignment', 'Vendor managers', { tags: ['Vendors'], parameters: [idParam, { name: 'requirementId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 204: { description: 'Removed' } } }).delete }],
  ['/api/vendors/{id}/invite', { post: jwtOp('post', 'Invite vendor user', 'Vendor managers', { tags: ['Vendors'], parameters: [idParam], requestBody: jsonBody({ type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' }, name: { type: 'string' } } }), responses: { 201: { description: 'Invited user' } } }).post }],
  ['/api/vendor-portal/me', { get: jwtOp('get', 'Vendor dashboard', vendorOnly, { tags: ['Vendor Portal'], responses: { 200: { description: 'Dashboard' } } }).get }],
  ['/api/vendor-portal/positions', { get: jwtOp('get', 'Assigned positions', vendorOnly, { tags: ['Vendor Portal'], responses: { 200: { description: 'Positions' } } }).get }],
  ['/api/vendor-portal/positions/{id}', { get: jwtOp('get', 'Position detail', vendorOnly, { tags: ['Vendor Portal'], parameters: [idParam], responses: { 200: { description: 'Position' } } }).get }],
  ['/api/vendor-portal/parse-resume', { post: jwtOp('post', 'Parse resume', vendorOnly, { tags: ['Vendor Portal'], requestBody: { required: true, content: { 'multipart/form-data': { schema: ref('ResumeUpload') } } }, responses: { 200: { description: 'Parsed fields' } } }).post }],
  ['/api/vendor-portal/check-email', { post: jwtOp('post', 'Check email', vendorOnly, { tags: ['Vendor Portal'], requestBody: emailLookupBody, responses: { 200: { description: 'Existence' } } }).post }],
  ['/api/vendor-portal/submissions', { get: jwtOp('get', 'My submissions', vendorOnly, { tags: ['Vendor Portal'], responses: { 200: arrResp('Candidate') } }).get }],
  ['/api/vendor-portal/submissions/{candidateId}', {
    get: jwtOp('get', 'Submission detail', vendorOnly, { tags: ['Vendor Portal'], parameters: [{ name: 'candidateId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: objResp('Candidate') } }).get,
    patch: jwtOp('patch', 'Update submission', vendorOnly, { tags: ['Vendor Portal'], parameters: [{ name: 'candidateId', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }, responses: { 200: objResp('Candidate') } }).patch,
  }],
  ['/api/vendor-portal/positions/{id}/submit', { post: jwtOp('post', 'Submit candidate', vendorOnly, { tags: ['Vendor Portal'], parameters: [idParam], requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }, responses: { 201: objResp('Candidate') } }).post }],
  ['/api/vendor-portal/submissions/{candidateId}/resume', {
    get: jwtOp('get', 'Download submission resume', vendorOnly, { tags: ['Vendor Portal'], parameters: [{ name: 'candidateId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'PDF/DOC binary' } } }).get,
    post: jwtOp('post', 'Upload submission resume', vendorOnly, { tags: ['Vendor Portal'], parameters: [{ name: 'candidateId', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'multipart/form-data': { schema: ref('ResumeUpload') } } }, responses: { 200: objResp('Candidate') } }).post,
  }],
])

const referralPortal = 'Referral portal (not CANDIDATE or VENDOR)'
addPaths([
  ['/api/referral-portal/me', { get: jwtOp('get', 'Referrer dashboard', referralPortal, { tags: ['Referral Portal'], responses: { 200: { description: 'Dashboard with referral code' } } }).get }],
  ['/api/referral-portal/positions', { get: jwtOp('get', 'Referral positions', referralPortal, { tags: ['Referral Portal'], responses: { 200: { description: 'Positions' } } }).get }],
  ['/api/referral-portal/positions/departments', { get: jwtOp('get', 'Position departments', referralPortal, { tags: ['Referral Portal'], responses: { 200: { description: 'Department names' } } }).get }],
  ['/api/referral-portal/positions/{id}', { get: jwtOp('get', 'Position detail', referralPortal, { tags: ['Referral Portal'], parameters: [idParam], responses: { 200: { description: 'Position' } } }).get }],
  ['/api/referral-portal/referrals', { get: jwtOp('get', 'My referrals', referralPortal, { tags: ['Referral Portal'], responses: { 200: arrResp('Candidate') } }).get }],
  ['/api/referral-portal/referrals/{id}', { get: jwtOp('get', 'Referral detail', referralPortal, { tags: ['Referral Portal'], parameters: [idParam], responses: { 200: objResp('Candidate') } }).get }],
  ['/api/referral-portal/parse-resume', { post: jwtOp('post', 'Parse resume', referralPortal, { tags: ['Referral Portal'], requestBody: { required: true, content: { 'multipart/form-data': { schema: ref('ResumeUpload') } } }, responses: { 200: { description: 'Parsed fields' } } }).post }],
  ['/api/referral-portal/check-email', { post: jwtOp('post', 'Check email', referralPortal, { tags: ['Referral Portal'], requestBody: emailLookupBody, responses: { 200: { description: 'Existence' } } }).post }],
  ['/api/referral-portal/positions/{id}/submit', { post: jwtOp('post', 'Submit referral', referralPortal, { tags: ['Referral Portal'], parameters: [idParam], requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }, responses: { 201: objResp('Candidate') } }).post }],
  ['/api/referral-portal/referrals/{candidateId}/resume', { post: jwtOp('post', 'Upload referral resume', referralPortal, { tags: ['Referral Portal'], parameters: [{ name: 'candidateId', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'multipart/form-data': { schema: ref('ResumeUpload') } } }, responses: { 200: objResp('Candidate') } }).post }],
])

// Catalogs & settings
const catalogCrud = (tag, name) => [
  [`/api/${name}`, {
    get: jwtOp('get', `List ${name}`, 'Internal', { tags: [tag], responses: { 200: { description: 'Catalog entries' } } }).get,
    post: jwtOp('post', `Create ${name.slice(0, -1)}`, 'ADMIN', { tags: [tag], requestBody: jsonBody({ type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 120 }, category: { type: 'string', maxLength: 40 } } }), responses: { 201: { description: 'Created' } } }).post,
  }],
  [`/api/${name}/{id}`, { delete: jwtOp('delete', `Delete ${name.slice(0, -1)}`, 'ADMIN', { tags: [tag], parameters: [idParam], responses: { 204: { description: 'Deleted' } } }).delete }],
  [`/api/${name}/seed-defaults`, { post: jwtOp('post', `Seed default ${name}`, 'ADMIN', { tags: [tag], responses: { 200: { description: 'Seeded' } } }).post }],
]
addPaths(catalogCrud('Skills', 'skills'))
addPaths(catalogCrud('Departments', 'departments'))
addPaths(catalogCrud('Clients', 'clients'))

addPaths([
  ['/api/role-access/definitions', { get: jwtOp('get', 'Page and role definitions', 'DEVELOPER', { tags: ['Role Access'], responses: { 200: { description: 'Definitions' } } }).get }],
  ['/api/role-access/me', { get: jwtOp('get', 'My allowed pages', 'Any authenticated', { tags: ['Role Access'], responses: { 200: { description: 'Role and pages' } } }).get }],
  ['/api/role-access', { get: jwtOp('get', 'Full access matrix', 'DEVELOPER', { tags: ['Role Access'], responses: { 200: { description: 'Access config' } } }).get }],
  ['/api/role-access/{role}', {
    put: jwtOp('put', 'Set role page access', 'DEVELOPER', {
      tags: ['Role Access'],
      parameters: [{ name: 'role', in: 'path', required: true, schema: ref('UserRole') }],
      requestBody: jsonBody({ type: 'object', required: ['pages'], properties: { pages: { type: 'array', items: { type: 'string' }, minItems: 1 } } }),
      responses: { 200: { description: 'Updated' } },
    }).put,
  }],
  ['/api/role-access/{role}/reset', {
    post: jwtOp('post', 'Reset role to defaults', 'DEVELOPER', {
      tags: ['Role Access'],
      parameters: [{ name: 'role', in: 'path', required: true, schema: ref('UserRole') }],
      responses: { 200: { description: 'Reset' } },
    }).post,
  }],
  ['/api/interview-panels', { get: jwtOp('get', 'List panel levels', 'Internal', { tags: ['Interview Panels'], responses: { 200: { description: 'Panel levels' } } }).get }],
  ['/api/interview-panels/seed', { post: jwtOp('post', 'Seed default panels', 'ADMIN', { tags: ['Interview Panels'], responses: { 200: { description: 'Seeded panels' } } }).post }],
  ['/api/interview-panels/{id}', {
    put: jwtOp('put', 'Update panel interviewers', 'ADMIN', {
      tags: ['Interview Panels'],
      parameters: [idParam],
      requestBody: jsonBody({ type: 'object', required: ['interviewerIds'], properties: { interviewerIds: { type: 'array', items: { type: 'string' } } } }),
      responses: { 200: { description: 'Updated panel' } },
    }).put,
  }],
  ['/api/offer-settings/compensation', {
    get: jwtOp('get', 'Get compensation config', 'Compensation/letter editors, TA_MANAGER, TEAM_LEAD', { tags: ['Offer Settings'], responses: { 200: { description: 'Config', content: { 'application/json': { schema: ref('CompensationConfig') } } } } }).get,
    put: jwtOp('put', 'Update compensation config', 'FINANCE_HEAD, SUPER_ADMIN, ADMIN', { tags: ['Offer Settings'], requestBody: { required: true, content: { 'application/json': { schema: ref('CompensationConfig') } } }, responses: { 200: { description: 'Updated config' } } }).put,
  }],
  ['/api/offer-settings/compensation/preview', {
    post: jwtOp('post', 'Preview compensation', 'Compensation editors', {
      tags: ['Offer Settings'],
      requestBody: jsonBody({ type: 'object', properties: { annualCtc: { type: 'number', minimum: 1000 }, config: ref('CompensationConfig') } }),
      responses: { 200: { description: 'Breakdown' } },
    }).post,
  }],
  ['/api/offer-settings/letter-template', {
    get: jwtOp('get', 'Get letter template', 'Letter template editors, TA_MANAGER', { tags: ['Offer Settings'], responses: { 200: { description: 'Template' } } }).get,
    put: jwtOp('put', 'Update letter template', 'Letter template editors', { tags: ['Offer Settings'], requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }, responses: { 200: { description: 'Updated' } } }).put,
  }],
  ['/api/offer-settings/letter-template/preview', { post: jwtOp('post', 'Preview letter HTML', 'Letter template editors', { tags: ['Offer Settings'], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { template: { type: 'object' }, annualCtc: { type: 'number' } } } } } }, responses: { 200: { description: 'HTML preview' } } }).post }],
  ['/api/offer-settings/letter-template/reset', { post: jwtOp('post', 'Reset letter template', 'Letter template editors', { tags: ['Offer Settings'], responses: { 200: { description: 'Default template' } } }).post }],
])

// M365
const m365Sec = { security: [{ integrationApiKey: [] }] }
function m365Op(method, summary, opts = {}) {
  return op(method, summary, { tags: ['M365 Integration'], ...m365Sec, ...opts, include503: true })
}
addPaths([
  ['/api/integrations/m365/setup-guide', { get: m365Op('get', 'M365 setup guide', { responses: { 200: { description: 'Setup guide object' } } }).get }],
  ['/api/integrations/m365/status', { get: m365Op('get', 'M365 integration status', { responses: { 200: { description: 'Status and connection' }, 503: errorResponse } }).get }],
  ['/api/integrations/m365/test-connection', { post: m365Op('post', 'Test M365 connection', { responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } } } }, 400: errorResponse } }).post }],
  ['/api/integrations/m365/test-email', {
    post: m365Op('post', 'Send test email via M365', {
      requestBody: jsonBody({ type: 'object', required: ['to'], properties: { to: { type: 'string', format: 'email' }, subject: { type: 'string', maxLength: 200 } } }),
      responses: {
        200: { description: 'Sent', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, messageId: { type: 'string' }, to: { type: 'string' } } } } } },
        503: errorResponse,
      },
    }).post,
  }],
])

// Remaining routes, one row each: [method, path, summary, roles, tag, opts?]
// roles === null marks a public route (no bearer token).
const anyBody = { content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }
const mfaCodeBody = jsonBody({
  type: 'object',
  required: ['mfaToken', 'code'],
  properties: {
    mfaToken: { type: 'string' },
    code: { type: 'string', minLength: 6, maxLength: 16, description: '6-digit authenticator code or a backup code' },
    rememberDevice: { type: 'boolean', description: 'Skip MFA on this device for 15 days' },
  },
})
const pathParam = (name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })
const routeTable = [
  // Auth (sessions, SSO)
  ['get', '/api/auth/sso', 'Which sign-in providers are configured', null, 'Auth'],
  ['post', '/api/auth/google', 'Candidate Google sign-in (GIS ID token)', null, 'Auth'],
  ['post', '/api/auth/microsoft', 'Staff Microsoft SSO (skips MFA)', null, 'Auth'],
  ['post', '/api/auth/refresh', 'Rotate the HttpOnly refresh cookie (send X-Stitch-CSRF: 1); returns a new access token', null, 'Auth'],
  ['post', '/api/auth/logout', 'Revoke the refresh cookie and clear it (send X-Stitch-CSRF: 1)', null, 'Auth'],
  ['post', '/api/auth/session-end', 'Record the end of a session (idle logout / tab close)', 'Any authenticated', 'Auth'],
  ['post', '/api/auth/session-resume', 'Record a resumed session', 'Any authenticated', 'Auth'],
  // MFA
  ['post', '/api/auth/mfa/verify', 'Second sign-in step: verify code, get session', null, 'MFA', { requestBody: mfaCodeBody, responses: { 200: objResp('Session'), 423: errorResponse } }],
  ['post', '/api/auth/mfa/setup/start', 'Start enrolment: returns QR code and secret', null, 'MFA', { requestBody: jsonBody({ type: 'object', required: ['mfaToken'], properties: { mfaToken: { type: 'string' } } }) }],
  ['post', '/api/auth/mfa/setup/confirm', 'Confirm first code: turns MFA on, returns session + 10 backup codes', null, 'MFA', { requestBody: mfaCodeBody, responses: { 200: objResp('Session'), 423: errorResponse } }],
  ['get', '/api/auth/mfa/status', 'My MFA status and backup codes left', 'Any active user', 'MFA'],
  ['post', '/api/auth/mfa/backup-codes/regenerate', 'New backup codes (needs a current code)', 'Any active user with MFA', 'MFA', { requestBody: jsonBody({ type: 'object', required: ['code'], properties: { code: { type: 'string' } } }) }],
  ['post', '/api/auth/mfa/reset/{userId}', 'Reset a user\'s MFA (they re-enrol at next sign-in)', 'DEVELOPER only', 'MFA', { parameters: [pathParam('userId')] }],
  // Users
  ['post', '/api/users/me/complete-profile', 'Complete own profile after first sign-in', 'Any active user', 'Users'],
  ['post', '/api/users/{id}/unlock', 'Unlock an account locked by failed sign-in or MFA attempts', 'SUPER_ADMIN', 'Users'],
  // Business requirements and client deals
  ['post', '/api/business-requirements/generate-job-description', 'Draft a job description with AI', 'Business mutate + staff mutate', 'Business Requirements', { requestBody: anyBody }],
  ['get', '/api/client-deals', 'List client deals', 'ACCOUNT_MANAGER, HIRING_MANAGER, ADMIN', 'Client Deals'],
  ['post', '/api/client-deals', 'Create client deal', 'ACCOUNT_MANAGER, HIRING_MANAGER, ADMIN', 'Client Deals', { requestBody: anyBody }],
  ['get', '/api/client-deals/{id}', 'Get client deal', 'Business view roles', 'Client Deals'],
  ['patch', '/api/client-deals/{id}/stage', 'Change deal stage', 'ACCOUNT_MANAGER, HIRING_MANAGER, ADMIN', 'Client Deals', { requestBody: anyBody }],
  ['patch', '/api/client-deals/{id}/sow-gateway', 'Update SOW gateway', 'ACCOUNT_MANAGER, HIRING_MANAGER, ADMIN', 'Client Deals', { requestBody: anyBody }],
  ['patch', '/api/client-deals/{id}/sow-signed', 'Mark SOW signed', 'ACCOUNT_MANAGER, HIRING_MANAGER, ADMIN', 'Client Deals', { requestBody: anyBody }],
  ['post', '/api/client-deals/{id}/cancel', 'Cancel client deal', 'ACCOUNT_MANAGER, HIRING_MANAGER, ADMIN', 'Client Deals'],
  // Requirements
  ['get', '/api/requirements/{id}/activity-logs', 'Requirement activity', 'Internal + access', 'Requirements'],
  ['get', '/api/requirements/{id}/vendors', 'Vendors assigned to requirement', 'Portal visibility + RECRUITER', 'Requirements'],
  ['put', '/api/requirements/{id}/vendors', 'Set vendors on requirement', 'Requirement assignment roles', 'Requirements', { requestBody: anyBody }],
  ['post', '/api/requirements/{id}/assign-recruiter/{recruiterId}/accept', 'Recruiter accepts assignment', 'RECRUITER', 'Requirements', { parameters: [pathParam('id'), pathParam('recruiterId')] }],
  ['post', '/api/requirements/{id}/assign-recruiter/{recruiterId}/reject', 'Recruiter rejects assignment', 'RECRUITER', 'Requirements', { parameters: [pathParam('id'), pathParam('recruiterId')] }],
  ['post', '/api/requirements/{id}/repurpose', 'Repurpose a requirement', 'Internal + access', 'Requirements'],
  // Candidates and interviews
  ['get', '/api/candidates/search', 'Talent-pool search (q, skills, location, experience, CTC, notice, status, source, paging)', 'Internal (INTERVIEWER blocked)', 'Candidates'],
  ['post', '/api/candidates/check-pan', 'Check whether a PAN already exists', 'Internal', 'Candidates', { requestBody: panLookupBody }],
  ['get', '/api/candidates/{id}/match-breakdown', 'Skill match breakdown against the linked job', 'Internal + access', 'Candidates'],
  ['get', '/api/interviews/on-my-requirements-today', 'Today\'s interviews on my requirements', 'Internal + ACCOUNT_MANAGER', 'Interviews'],
  ['get', '/api/interview-rsvp', 'Show accept/decline page for an emailed invite', null, 'Interview RSVP'],
  ['post', '/api/interview-rsvp', 'Record accept/decline (form post)', null, 'Interview RSVP'],
  // Portals
  ['post', '/api/portal/parse-resume', 'Parse resume to prefill profile', 'CANDIDATE', 'Candidate Portal'],
  ['post', '/api/referral-portal/check-pan', 'Check PAN before referring', 'Referral portal', 'Referral Portal', { requestBody: panLookupBody }],
  ['post', '/api/referral-portal/submit', 'Submit a general referral (no specific job)', 'Referral portal', 'Referral Portal', { requestBody: anyBody }],
  ['post', '/api/vendor-portal/check-pan', 'Check PAN before submitting', 'VENDOR', 'Vendor Portal', { requestBody: panLookupBody }],
  ['get', '/api/vendor-portal/onboarding', 'Get my onboarding packet', 'VENDOR', 'Vendor Portal'],
  ['patch', '/api/vendor-portal/onboarding', 'Save onboarding packet', 'VENDOR', 'Vendor Portal', { requestBody: anyBody }],
  ['patch', '/api/vendor-portal/onboarding/evaluation', 'Save onboarding self-evaluation', 'VENDOR', 'Vendor Portal', { requestBody: anyBody }],
  ['post', '/api/vendor-portal/onboarding/submit', 'Submit onboarding for review', 'VENDOR', 'Vendor Portal'],
  // Referral review
  ['get', '/api/referral-review/program', 'Referral validity, service period and bonus tiers', 'Internal', 'Referral Review'],
  ['get', '/api/referral-review/access', 'What the current user may do in the queue', 'Internal', 'Referral Review'],
  ['get', '/api/referral-review/recruiters', 'Recruiters available for assignment', 'Referral reviewers', 'Referral Review'],
  ['get', '/api/referral-review', 'Referral queue', 'SUPER_ADMIN, ADMIN, HR_HEAD, TA_MANAGER, employee_referral or ta_operation tag', 'Referral Review'],
  ['get', '/api/referral-review/assigned', 'Referrals assigned to me (recruiter)', 'RECRUITER', 'Referral Review'],
  ['get', '/api/referral-review/bonuses', 'Referral bonus list', 'TA_MANAGER, ADMIN, SUPER_ADMIN', 'Referral Review'],
  ['get', '/api/referral-review/{id}', 'Referral detail', 'Referral queue viewers', 'Referral Review'],
  ['post', '/api/referral-review/{id}/assign', 'Assign to recruiter (emails candidate: shortlisted)', 'Referral reviewers', 'Referral Review', { requestBody: anyBody }],
  ['post', '/api/referral-review/{id}/reject', 'Reject referral (emails candidate: not selected)', 'Referral reviewers', 'Referral Review', { requestBody: anyBody }],
  ['post', '/api/referral-review/{id}/accept', 'Recruiter accepts referral into the pipeline', 'Assigned recruiter', 'Referral Review'],
  ['post', '/api/referral-review/{id}/recruiter-reject', 'Recruiter sends referral to the bank', 'Assigned recruiter', 'Referral Review', { requestBody: anyBody }],
  ['post', '/api/referral-review/{id}/bonus', 'Grant, cancel or mark bonus paid', 'TA_MANAGER, ADMIN, SUPER_ADMIN', 'Referral Review', { requestBody: anyBody }],
  // Vendors
  ['get', '/api/vendors/creation-requests', 'Vendor creation requests (own requests for TA Operation)', 'SUPER_ADMIN, DEVELOPER, TA_MANAGER, ta_operation tag', 'Vendors'],
  ['post', '/api/vendors/creation-requests', 'Request a new vendor; emails TA Managers', 'ta_operation tag', 'Vendors', { requestBody: jsonBody({ type: 'object', required: ['name', 'email', 'contactName'], properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' }, contactName: { type: 'string', description: 'SPOC name' }, phone: { type: 'string' }, notes: { type: 'string' } } }), responses: { 201: { description: 'Created' } } }],
  ['post', '/api/vendors/creation-requests/{id}/decision', 'Approve (→ READY, emails creators) or reject (emails requester)', 'TA_MANAGER (exact; Developer passes)', 'Vendors', { requestBody: jsonBody({ type: 'object', required: ['action', 'reason'], properties: { action: { type: 'string', enum: ['APPROVE', 'REJECT'] }, reason: { type: 'string', minLength: 1 } } }) }],
  ['get', '/api/vendors/{id}/activity-logs', 'Vendor activity', 'Vendor managers', 'Vendors'],
  ['post', '/api/vendors/{id}/reinvite', 'Re-send vendor portal invite', 'SUPER_ADMIN', 'Vendors'],
  ['delete', '/api/vendors/{id}', 'Delete vendor', 'SUPER_ADMIN', 'Vendors', { responses: { 204: { description: 'Deleted' } } }],
  ['get', '/api/vendor-onboarding/pending', 'Onboarding packets awaiting review', 'TA_MANAGER, HR_HEAD (exact)', 'Vendor Onboarding'],
  ['get', '/api/vendor-onboarding/vendor/{vendorId}', 'Onboarding packet for a vendor', 'Vendor managers', 'Vendor Onboarding', { parameters: [pathParam('vendorId')] }],
  ['post', '/api/vendor-onboarding/vendor/{vendorId}/decision', 'Approve or return onboarding', 'TA_MANAGER, HR_HEAD (exact)', 'Vendor Onboarding', { parameters: [pathParam('vendorId')], requestBody: anyBody }],
  // Reports
  ['get', '/api/reports/ta', 'TA report', 'SUPER_ADMIN, ADMIN, HR_HEAD, TA_MANAGER, TEAM_LEAD, RECRUITER', 'Reports'],
  ['get', '/api/reports/hiring', 'Hiring report', 'Hiring report roles (not RECRUITER)', 'Reports'],
  ['get', '/api/reports/referrals', 'Employee referral report', 'SUPER_ADMIN, ADMIN, HR_HEAD, TA_MANAGER', 'Reports'],
  ['get', '/api/reports/vendors', 'Vendor report', 'SUPER_ADMIN, ADMIN, HR_HEAD, TA_MANAGER', 'Reports'],
  ['get', '/api/open-requisition-report/recipients', 'Daily open requisition report recipients', 'SUPER_ADMIN', 'Reports'],
  ['put', '/api/open-requisition-report/recipients', 'Set report recipients', 'SUPER_ADMIN', 'Reports', { requestBody: anyBody }],
  ['post', '/api/open-requisition-report/send', 'Send the report now', 'SUPER_ADMIN', 'Reports'],
  // Self-service
  ['get', '/api/change-requests/modules', 'Modules a change request can target', 'Self-service access', 'Change Requests'],
  ['get', '/api/change-requests', 'List change requests', 'Self-service access', 'Change Requests'],
  ['get', '/api/change-requests/{id}', 'Get change request', 'Self-service access', 'Change Requests'],
  ['post', '/api/change-requests', 'Create change request', 'Self-service access', 'Change Requests', { requestBody: anyBody }],
  ['post', '/api/change-requests/{id}/approve-hr', 'HR approve', 'TA_MANAGER, HR_HEAD', 'Change Requests'],
  ['post', '/api/change-requests/{id}/reject-hr', 'HR reject', 'TA_MANAGER, HR_HEAD', 'Change Requests'],
  ['post', '/api/change-requests/{id}/close', 'Close change request', 'Self-service access', 'Change Requests'],
  ['post', '/api/change-requests/{id}/approve-admin', 'Admin approve', 'ADMIN, SUPER_ADMIN', 'Change Requests'],
  ['post', '/api/change-requests/{id}/reject-admin', 'Admin reject', 'ADMIN, SUPER_ADMIN', 'Change Requests'],
  ['post', '/api/change-requests/{id}/developer', 'Developer update', 'DEVELOPER', 'Change Requests', { requestBody: anyBody }],
  ['delete', '/api/change-requests/{id}', 'Delete change request', 'SUPER_ADMIN, DEVELOPER', 'Change Requests'],
  // Catalogs, market trends, notifications, assistant
  ['get', '/api/cities', 'List cities', 'Any active user', 'Catalogs'],
  ['post', '/api/cities', 'Add city', 'Internal', 'Catalogs', { requestBody: anyBody }],
  ['patch', '/api/cities/{id}', 'Update city', 'SUPER_ADMIN', 'Catalogs', { requestBody: anyBody }],
  ['delete', '/api/cities/{id}', 'Delete city', 'SUPER_ADMIN', 'Catalogs'],
  ['post', '/api/cities/seed-defaults', 'Seed default cities', 'SUPER_ADMIN', 'Catalogs'],
  ['get', '/api/dropdown-catalogs', 'Shared dropdown lists', 'Internal', 'Catalogs'],
  ['put', '/api/dropdown-catalogs', 'Save dropdown lists', 'SUPER_ADMIN', 'Catalogs', { requestBody: anyBody }],
  ['post', '/api/dropdown-catalogs/reset-defaults', 'Reset dropdown lists', 'SUPER_ADMIN', 'Catalogs'],
  ['get', '/api/market-trends', 'Skill pay bands and city multipliers', 'Market trends page or market_data tag', 'Market Trends'],
  ['post', '/api/market-trends/skills', 'Add skill row', 'Market data editors', 'Market Trends', { requestBody: anyBody }],
  ['put', '/api/market-trends/skills/{id}', 'Update skill row', 'Market data editors', 'Market Trends', { requestBody: anyBody }],
  ['delete', '/api/market-trends/skills/{id}', 'Delete skill row', 'Market data editors', 'Market Trends'],
  ['put', '/api/market-trends/locations', 'Save city multipliers', 'Market data editors', 'Market Trends', { requestBody: anyBody }],
  ['get', '/api/notifications/read-ids', 'Notification ids I have read', 'Any active user', 'Notifications'],
  ['post', '/api/notifications/read-ids/mark', 'Mark notifications read', 'Any active user', 'Notifications', { requestBody: anyBody }],
  ['get', '/api/assistant/examples', 'Example assistant questions', 'Internal', 'Assistant'],
  ['post', '/api/assistant/ask', 'Ask the assistant (rate-limited)', 'Internal', 'Assistant', { requestBody: anyBody }],
  // Workspace admin
  ['get', '/api/privacy', 'Retention settings, bounds, groups, last run', 'SUPER_ADMIN, ADMIN, HR_HEAD', 'Workspace Admin'],
  ['get', '/api/privacy/history', 'Recent retention runs', 'SUPER_ADMIN, ADMIN, HR_HEAD', 'Workspace Admin'],
  ['put', '/api/privacy', 'Save retention settings', 'DEVELOPER only', 'Workspace Admin', { requestBody: anyBody }],
  ['post', '/api/privacy/run', 'Run retention now (dry run unless Live)', 'DEVELOPER only', 'Workspace Admin'],
  ['post', '/api/privacy/preview', 'Count what draft settings would affect', 'DEVELOPER only', 'Workspace Admin', { requestBody: anyBody }],
  ['get', '/api/email-toggles', 'Email type on/off switches', 'DEVELOPER only', 'Workspace Admin'],
  ['put', '/api/email-toggles', 'Save email switches', 'DEVELOPER only', 'Workspace Admin', { requestBody: anyBody }],
  ['post', '/api/email-toggles/reset', 'Reset email switches', 'DEVELOPER only', 'Workspace Admin'],
  ['get', '/api/email-toggles/copy', 'Email wording and placeholders', 'DEVELOPER only', 'Workspace Admin'],
  ['put', '/api/email-toggles/copy', 'Save email wording', 'DEVELOPER only', 'Workspace Admin', { requestBody: anyBody }],
  ['post', '/api/email-toggles/copy/reset', 'Reset email wording', 'DEVELOPER only', 'Workspace Admin'],
  ['get', '/api/email-toggles/workflow', 'Workflow mail templates and recipients', 'DEVELOPER only', 'Workspace Admin'],
  ['put', '/api/email-toggles/workflow', 'Save workflow mail (To/Cc/Bcc roles + extra addresses)', 'DEVELOPER only', 'Workspace Admin', { requestBody: anyBody }],
  ['post', '/api/email-toggles/workflow/reset', 'Reset workflow mail', 'DEVELOPER only', 'Workspace Admin'],
  ['post', '/api/email-toggles/workflow/preview', 'Preview a workflow mail', 'DEVELOPER only', 'Workspace Admin', { requestBody: anyBody }],
  ['get', '/api/email-toggles/reports', 'Report mail settings (open requisition, aging)', 'DEVELOPER only', 'Workspace Admin'],
  ['put', '/api/email-toggles/reports', 'Save report mail settings', 'DEVELOPER only', 'Workspace Admin', { requestBody: anyBody }],
  ['get', '/api/database-backups', 'List backups', 'DEVELOPER only', 'Workspace Admin'],
  ['post', '/api/database-backups', 'Run a backup now', 'DEVELOPER only', 'Workspace Admin'],
  ['get', '/api/page-publication', 'Published pages', 'DEVELOPER only', 'Workspace Admin'],
  ['put', '/api/page-publication', 'Publish or unpublish pages', 'DEVELOPER only', 'Workspace Admin', { requestBody: anyBody }],
  ['post', '/api/page-publication/reset', 'Reset page publication', 'DEVELOPER only', 'Workspace Admin'],
  ['get', '/api/feature-flags', 'Feature flags', 'Any active user', 'Workspace Admin'],
  ['put', '/api/feature-flags', 'Save feature flags', 'SUPER_ADMIN', 'Workspace Admin', { requestBody: anyBody }],
  ['post', '/api/feature-flags/reset', 'Reset feature flags', 'SUPER_ADMIN', 'Workspace Admin'],
]
for (const [method, path, summary, roles, tag, opts = {}] of routeTable) {
  const params = opts.parameters ?? (path.includes('{id}') ? [{ ...idParam, schema: { type: 'string' } }] : undefined)
  const operation =
    roles === null
      ? op(method, summary, { tags: [tag], security: [], ...opts, parameters: params })
      : jwtOp(method, summary, roles, { tags: [tag], ...opts, parameters: params })
  addPaths([[path, operation]])
}

// Count operations
let opCount = 0
for (const pathItem of Object.values(spec.paths)) {
  opCount += Object.keys(pathItem).filter((k) => ['get', 'post', 'put', 'patch', 'delete'].includes(k)).length
}

const header = `# OpenAPI 3.0 — Stitch ATS API\n# Generated: ${new Date().toISOString()}\n# Total operations: ${opCount}\n# Regenerate: node server/scripts/generate-openapi.mjs\n\n`
writeFileSync(outPath, header + toYaml(spec))
console.log(`Wrote ${outPath} (${opCount} operations)`)

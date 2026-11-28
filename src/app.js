import express from 'express'
import cors from 'cors'
import { env } from './config/env.js'
import systemRoutes from './routes/system.routes.js'
import authRoutes from './routes/auth.routes.js'
import publicRoutes from './routes/public.routes.js'
import studentRoutes from './routes/students.routes.js'
import staffRoutes from './routes/staff.routes.js'
import courseRoutes from './routes/courses.routes.js'
import batchRoutes from './routes/batches.routes.js'
import feeRoutes from './routes/fees.routes.js'
import invoiceRoutes from './routes/invoices.routes.js'
import receiptRoutes from './routes/receipts.routes.js'
import expenseRoutes from './routes/expenses.routes.js'
import examRoutes from './routes/examinations.routes.js'
import certificateRoutes from './routes/certificates.routes.js'
import enquiryRoutes from './routes/enquiries.routes.js'
import notificationRoutes from './routes/notifications.routes.js'
import attendanceRoutes from './routes/attendance.routes.js'
import dashboardRoutes from './routes/dashboard.routes.js'
import { requireAuth, requireRole } from './middleware/auth.js'
import { auditMutations } from './lib/audit.js'
import { errorHandler, HttpError, notFound } from './middleware/errorHandler.js'

export const app = express()

// Trust reverse proxies (Render, AWS ALB, Cloudflare, etc.) so client IP is accurately extracted
app.set('trust proxy', 1)

// Guard write operations (POST/PUT/PATCH/DELETE) by role while allowing authenticated reads.
function protectWrites(...roles) {
  const roleCheck = requireRole(...roles)
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next()
    return roleCheck(req, res, next)
  }
}

// CORS: only the listed frontend origins may call the API from a browser.
app.use(
  cors({
    origin(origin, cb) {
      // No Origin header = curl/Postman/server-to-server, which is fine.
      if (!origin || env.corsOrigins.includes('*') || env.corsOrigins.includes(origin)) return cb(null, true)
      cb(new HttpError(403, `Origin ${origin} is not allowed by CORS`, 'CORS_BLOCKED'))
    },
  }),
)
app.use(express.json({ limit: '1mb' }))

// ── Public routes ─────────────────────────────────────────────────────────────
app.use('/api', systemRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/public', publicRoutes)

// ── Protected business API routes (JWT + RBAC + Audit logging) ────────────────
app.use('/api/students',      requireAuth, auditMutations('student'),      studentRoutes)
app.use('/api/staff',         requireAuth, protectWrites('admin'),         auditMutations('staff'),        staffRoutes)
app.use('/api/courses',       requireAuth, auditMutations('course'),       courseRoutes)
app.use('/api/batches',       requireAuth, auditMutations('batch'),        batchRoutes)
app.use('/api/fees',          requireAuth, protectWrites('admin', 'accountant'), auditMutations('fee'),    feeRoutes)
app.use('/api/invoices',      requireAuth, protectWrites('admin', 'accountant'), auditMutations('invoice'), invoiceRoutes)
app.use('/api/receipts',      requireAuth, protectWrites('admin', 'accountant'), auditMutations('receipt'), receiptRoutes)
app.use('/api/expenses',      requireAuth, protectWrites('admin', 'accountant'), auditMutations('expense'), expenseRoutes)
app.use('/api/examinations',  requireAuth, auditMutations('examination'),  examRoutes)
app.use('/api/certificates',  requireAuth, auditMutations('certificate'),  certificateRoutes)
app.use('/api/enquiries',     requireAuth, auditMutations('enquiry'),      enquiryRoutes)
app.use('/api/notifications', requireAuth, notificationRoutes)
app.use('/api/attendance',    requireAuth, auditMutations('attendance'),   attendanceRoutes)
app.use('/api/dashboard',     requireAuth, dashboardRoutes)

app.use(notFound)
app.use(errorHandler)

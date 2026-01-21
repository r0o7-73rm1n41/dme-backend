// modules/admin/adminAudit.service.js
import AdminAudit from "./adminAudit.model.js";

export async function logAdminAction(adminId, action, targetType, targetId, details = {}, req = null) {
  try {
    const auditEntry = new AdminAudit({
      admin: adminId,
      action,
      targetType,
      targetId,
      details,
      ipAddress: req?.ip || req?.connection?.remoteAddress,
      userAgent: req?.headers?.['user-agent']
    });

    await auditEntry.save();
    console.log(`Admin audit: ${action} by ${adminId} on ${targetType}:${targetId}`);
  } catch (error) {
    console.error('Failed to log admin action:', error);
    // Don't throw - audit logging failure shouldn't break business logic
  }
}

export async function getAdminAuditLog(adminId = null, action = null, limit = 100) {
  const query = {};
  if (adminId) query.admin = adminId;
  if (action) query.action = action;

  return await AdminAudit.find(query)
    .populate('admin', 'name email')
    .sort({ createdAt: -1 })
    .limit(limit);
}

export async function getAuditTrail(targetType, targetId) {
  return await AdminAudit.find({ targetType, targetId })
    .populate('admin', 'name email')
    .sort({ createdAt: -1 });
}
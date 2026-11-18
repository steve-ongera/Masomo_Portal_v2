// Boarding & hostel API. Lives in its own file so services/api.js stays untouched.
// (If you prefer one file, paste everything below the import into api.js.)
import api, { unwrap, errMsg } from "./api";

export { unwrap, errMsg };

const B = "/boarding";

export const boardingApi = {
  // who am I / what may I do
  access: () => api.get(`${B}/access/`),
  dashboard: () => api.get(`${B}/dashboard/`),

  // settings (admin writes, staff read)
  settings: () => api.get(`${B}/settings/`),
  updateSettings: (payload) => api.patch(`${B}/settings/`, payload),
  wardenUsers: () => api.get(`${B}/wardens/`),

  // structure
  dormitories: (params) => api.get(`${B}/dormitories/`, { params }),
  createDormitory: (payload) => api.post(`${B}/dormitories/`, payload),
  updateDormitory: (id, payload) => api.patch(`${B}/dormitories/${id}/`, payload),
  deleteDormitory: (id) => api.delete(`${B}/dormitories/${id}/`),
  setWardens: (id, userIds) => api.post(`${B}/dormitories/${id}/set_wardens/`, { user_ids: userIds }),
  generateRooms: (id, payload) => api.post(`${B}/dormitories/${id}/generate_rooms/`, payload),
  occupancy: (id, academicYear) =>
    api.get(`${B}/dormitories/${id}/occupancy/`, { params: { academic_year: academicYear } }),

  rooms: (params) => api.get(`${B}/rooms/`, { params }),
  updateRoom: (id, payload) => api.patch(`${B}/rooms/${id}/`, payload),
  deleteRoom: (id) => api.delete(`${B}/rooms/${id}/`),
  addBeds: (roomId, count) => api.post(`${B}/rooms/${roomId}/add_beds/`, { count }),

  beds: (params) => api.get(`${B}/beds/`, { params }),
  updateBed: (id, payload) => api.patch(`${B}/beds/${id}/`, payload),
  deleteBed: (id) => api.delete(`${B}/beds/${id}/`),
  bedHistory: (id, params) => api.get(`${B}/beds/${id}/history/`, { params }),

  // boarders
  registrations: (params) => api.get(`${B}/registrations/`, { params }),
  eligible: (params) => api.get(`${B}/registrations/eligible/`, { params }),
  registerStudent: (payload) => api.post(`${B}/registrations/`, payload),
  registerClassroom: (classroom) => api.post(`${B}/registrations/register_classroom/`, { classroom }),
  withdraw: (id, reason) => api.post(`${B}/registrations/${id}/withdraw/`, { reason }),
  studentHistory: (student) => api.get(`${B}/registrations/history/`, { params: { student } }),

  // bed allocation
  allocations: (params) => api.get(`${B}/allocations/`, { params }),
  allocate: (payload) => api.post(`${B}/allocations/allocate/`, payload),
  transfer: (payload) => api.post(`${B}/allocations/transfer/`, payload),
  release: (id, payload = {}) => api.post(`${B}/allocations/${id}/release/`, payload),
  autoAllocate: (payload) => api.post(`${B}/allocations/auto_allocate/`, payload),
  rollover: (payload) => api.post(`${B}/allocations/rollover/`, payload),

  // exeat / leave-out
  exeats: (params) => api.get(`${B}/exeats/`, { params }),
  createExeat: (payload) => api.post(`${B}/exeats/`, payload),
  exeat: (id) => api.get(`${B}/exeats/${id}/`),
  exeatAct: (id, action, body = {}) => api.post(`${B}/exeats/${id}/${action}/`, body),
  // actions: approve | reject (note required) | cancel | check_out | check_in

  // roll call
  rollCalls: (params) => api.get(`${B}/roll-calls/`, { params }),
  openRollCall: (payload) => api.post(`${B}/roll-calls/`, payload),
  rollCall: (id) => api.get(`${B}/roll-calls/${id}/`),
  markRollCall: (id, marks) => api.post(`${B}/roll-calls/${id}/mark/`, { marks }),
  submitRollCall: (id) => api.post(`${B}/roll-calls/${id}/submit/`),
  reopenRollCall: (id) => api.post(`${B}/roll-calls/${id}/reopen/`),
  absentees: (date) => api.get(`${B}/roll-calls/absentees/`, { params: { date } }),

  // boarding fees
  feeRates: (params) => api.get(`${B}/fee-rates/`, { params }),
  createFeeRate: (payload) => api.post(`${B}/fee-rates/`, payload),
  updateFeeRate: (id, payload) => api.patch(`${B}/fee-rates/${id}/`, payload),
  deleteFeeRate: (id) => api.delete(`${B}/fee-rates/${id}/`),
  billFees: (payload) => api.post(`${B}/fee-rates/bill/`, payload),
  billings: (params) => api.get(`${B}/fee-rates/billings/`, { params }),

  // student / parent
  my: () => api.get(`${B}/my/`),
  requestExeat: (payload) => api.post(`${B}/my/exeat-requests/`, payload),
};
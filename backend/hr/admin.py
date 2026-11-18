from django.contrib import admin
from . import models

for m in (models.Department, models.Position, models.Employee, models.LeaveType,
          models.LeaveRequest, models.StaffAttendance):
    admin.site.register(m)

from django.contrib import admin

from . import models


class MealPlanItemInline(admin.TabularInline):
    model = models.MealPlanItem
    extra = 0


@admin.register(models.MealPlan)
class MealPlanAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "billing_mode", "is_active")
    inlines = [MealPlanItemInline]


@admin.register(models.MealCard)
class MealCardAdmin(admin.ModelAdmin):
    list_display = ("card_number", "student", "status", "issued_at")
    list_filter = ("status",)
    search_fields = ("card_number", "student__admission_no")
    readonly_fields = ("qr_token",)


@admin.register(models.MealCollection)
class MealCollectionAdmin(admin.ModelAdmin):
    list_display = ("student", "meal_type", "date", "collected_at", "collected_by", "source")
    list_filter = ("meal_type", "date", "source")


admin.site.register(models.CafeteriaAttendant)
admin.site.register(models.StudentMealPlan)
admin.site.register(models.MealWallet)
admin.site.register(models.MealWalletTransaction)
import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const staffUsers = sqliteTable("staff_users", {
  id: text("id").primaryKey(),
  userId: text("user_id"), email: text("email").notNull(), name: text("name").notNull(),
  role: text("role", { enum: ["admin", "employee"] }).notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, table => [uniqueIndex("staff_user_identity_unique").on(table.userId), uniqueIndex("staff_user_email_unique").on(table.email)]);

export const companySettings = sqliteTable("company_settings", {
  id: text("id").primaryKey(), data: text("data").notNull(),
  updatedBy: text("updated_by").notNull().references(() => staffUsers.id),
  updatedAt: text("updated_at").notNull(),
});

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(), name: text("name").notNull(), phone: text("phone").notNull().default(""),
  notes: text("notes").notNull().default(""), ownerId: text("owner_id").notNull().references(() => staffUsers.id),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, table => [index("customer_owner_idx").on(table.ownerId)]);

export const styles = sqliteTable("styles", {
  id: text("id").primaryKey(), data: text("data").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
});

export const quotes = sqliteTable("quotes", {
  id: text("id").primaryKey(), number: text("number").notNull(),
  type: text("type", { enum: ["sale", "custom", "tradein", "recycling", "repair"] }).notNull(),
  customerId: text("customer_id").notNull().references(() => customers.id),
  customerName: text("customer_name").notNull(), ownerId: text("owner_id").notNull().references(() => staffUsers.id),
  title: text("title").notNull(), snapshot: text("snapshot").notNull(), totals: text("totals").notNull(),
  total: integer("total_cents").notNull(), rootId: text("root_id").notNull(),
  baseQuoteId: text("base_quote_id"), version: integer("version").notNull(), createdAt: text("created_at").notNull(),
}, table => [uniqueIndex("quote_number_unique").on(table.number), uniqueIndex("quote_version_unique").on(table.rootId, table.version), index("quote_owner_date_idx").on(table.ownerId, table.createdAt), index("quote_customer_idx").on(table.customerId)]);

export const quoteAttachments = sqliteTable("quote_attachments", {
  quoteId: text("quote_id").primaryKey().references(() => quotes.id),
  images: text("images").notNull(), createdBy: text("created_by").notNull().references(() => staffUsers.id),
  createdAt: text("created_at").notNull(),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(), entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(),
  action: text("action").notNull(), actorId: text("actor_id").notNull().references(() => staffUsers.id),
  actorName: text("actor_name").notNull(), oldValue: text("old_value"), newValue: text("new_value"),
  createdAt: text("created_at").notNull(),
}, table => [index("audit_entity_idx").on(table.entityType, table.entityId, table.createdAt)]);

export const staffPreferences = sqliteTable("staff_preferences", {
  staffId: text("staff_id").primaryKey().references(() => staffUsers.id),
  paymentMethods: text("payment_methods").notNull(), updatedAt: text("updated_at").notNull(),
});

export const mediaAssets = sqliteTable("media_assets", {
  id: text("id").primaryKey(), name: text("name").notNull(), category: text("category").notNull(),
  url: text("url").notNull(), ownerId: text("owner_id").notNull().references(() => staffUsers.id),
  ownerName: text("owner_name").notNull(), createdAt: text("created_at").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
}, table => [uniqueIndex("media_asset_url_unique").on(table.url), index("media_active_date_idx").on(table.active, table.createdAt)]);

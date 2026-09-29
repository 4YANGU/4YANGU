import { boolean, integer, jsonb, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const stores = pgTable("stores", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url").notNull().default(""),
  visitorTotal: integer("visitor_total").notNull().default(0),
  visitorToday: integer("visitor_today").notNull().default(0),
  ordersTotal: integer("orders_total").notNull().default(0),
  ordersToday: integer("orders_today").notNull().default(0),
  customers: integer("customers").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull(),
  displayName: text("display_name").notNull(),
  storeId: integer("store_id"),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull(),
  name: text("name").notNull(),
  price: numeric("price", { precision: 12, scale: 2 }).notNull().default("0"),
  imageUrl: text("image_url").notNull().default(""),
  images: jsonb("images").$type<string[]>().notNull().default([]),
  videoUrl: text("video_url").notNull().default(""),
  colors: jsonb("colors").$type<string[]>().notNull().default([]),
  sizes: jsonb("sizes").$type<string[]>().notNull().default([]),
  viewsTotal: integer("views_total").notNull().default(0),
  viewsToday: integer("views_today").notNull().default(0),
  ordersTotal: integer("orders_total").notNull().default(0),
  ordersToday: integer("orders_today").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const threads = pgTable("threads", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull(),
  platform: text("platform").notNull().default("whatsapp"),
  kind: text("kind").notNull().default("dm"),
  senderName: text("sender_name").notNull(),
  senderHandle: text("sender_handle").notNull().default(""),
  sourceTitle: text("source_title").notNull().default(""),
  resolved: boolean("resolved").notNull().default(false),
  lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull(),
  direction: text("direction").notNull(),
  body: text("body").notNull().default(""),
  attachmentName: text("attachment_name").notNull().default(""),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  kind: text("kind").notNull().default("message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

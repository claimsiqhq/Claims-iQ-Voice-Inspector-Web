import { db } from "./db";
import {
  claims, documents, extractions, briefings, users,
  type Claim, type InsertClaim,
  type Document, type InsertDocument,
  type Extraction, type InsertExtraction,
  type Briefing, type InsertBriefing,
  type User, type InsertUser,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: any): Promise<User>;

  createClaim(data: InsertClaim): Promise<Claim>;
  getClaims(): Promise<Claim[]>;
  getClaim(id: number): Promise<Claim | undefined>;
  updateClaimStatus(id: number, status: string): Promise<Claim | undefined>;

  createDocument(data: any): Promise<Document>;
  getDocuments(claimId: number): Promise<Document[]>;
  getDocument(claimId: number, documentType: string): Promise<Document | undefined>;
  updateDocumentStatus(id: number, status: string, rawText?: string): Promise<Document | undefined>;
  updateDocumentError(id: number, errorMessage: string): Promise<Document | undefined>;

  createExtraction(data: InsertExtraction): Promise<Extraction>;
  getExtractions(claimId: number): Promise<Extraction[]>;
  getExtraction(claimId: number, documentType: string): Promise<Extraction | undefined>;
  updateExtraction(id: number, extractedData: any): Promise<Extraction | undefined>;
  confirmExtraction(id: number): Promise<Extraction | undefined>;

  createBriefing(data: InsertBriefing): Promise<Briefing>;
  getBriefing(claimId: number): Promise<Briefing | undefined>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(data: any): Promise<User> {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  }

  async createClaim(data: InsertClaim): Promise<Claim> {
    const [claim] = await db.insert(claims).values(data).returning();
    return claim;
  }

  async getClaims(): Promise<Claim[]> {
    return db.select().from(claims).orderBy(desc(claims.createdAt));
  }

  async getClaim(id: number): Promise<Claim | undefined> {
    const [claim] = await db.select().from(claims).where(eq(claims.id, id));
    return claim;
  }

  async updateClaimStatus(id: number, status: string): Promise<Claim | undefined> {
    const [claim] = await db
      .update(claims)
      .set({ status, updatedAt: new Date() })
      .where(eq(claims.id, id))
      .returning();
    return claim;
  }

  async createDocument(data: any): Promise<Document> {
    const [doc] = await db.insert(documents).values(data).returning();
    return doc;
  }

  async getDocuments(claimId: number): Promise<Document[]> {
    return db.select().from(documents).where(eq(documents.claimId, claimId));
  }

  async getDocument(claimId: number, documentType: string): Promise<Document | undefined> {
    const [doc] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.claimId, claimId), eq(documents.documentType, documentType)));
    return doc;
  }

  async updateDocumentStatus(id: number, status: string, rawText?: string): Promise<Document | undefined> {
    const update: any = { status };
    if (rawText !== undefined) update.rawText = rawText;
    const [doc] = await db.update(documents).set(update).where(eq(documents.id, id)).returning();
    return doc;
  }

  async updateDocumentError(id: number, errorMessage: string): Promise<Document | undefined> {
    const [doc] = await db
      .update(documents)
      .set({ status: "error", errorMessage })
      .where(eq(documents.id, id))
      .returning();
    return doc;
  }

  async createExtraction(data: InsertExtraction): Promise<Extraction> {
    const [ext] = await db.insert(extractions).values(data).returning();
    return ext;
  }

  async getExtractions(claimId: number): Promise<Extraction[]> {
    return db.select().from(extractions).where(eq(extractions.claimId, claimId));
  }

  async getExtraction(claimId: number, documentType: string): Promise<Extraction | undefined> {
    const [ext] = await db
      .select()
      .from(extractions)
      .where(and(eq(extractions.claimId, claimId), eq(extractions.documentType, documentType)));
    return ext;
  }

  async updateExtraction(id: number, extractedData: any): Promise<Extraction | undefined> {
    const [ext] = await db
      .update(extractions)
      .set({ extractedData, updatedAt: new Date() })
      .where(eq(extractions.id, id))
      .returning();
    return ext;
  }

  async confirmExtraction(id: number): Promise<Extraction | undefined> {
    const [ext] = await db
      .update(extractions)
      .set({ confirmedByUser: true, updatedAt: new Date() })
      .where(eq(extractions.id, id))
      .returning();
    return ext;
  }

  async createBriefing(data: InsertBriefing): Promise<Briefing> {
    const [briefing] = await db.insert(briefings).values(data).returning();
    return briefing;
  }

  async getBriefing(claimId: number): Promise<Briefing | undefined> {
    const [briefing] = await db.select().from(briefings).where(eq(briefings.claimId, claimId));
    return briefing;
  }
}

export const storage = new DatabaseStorage();

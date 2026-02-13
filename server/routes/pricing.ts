import { Router } from "express";
import { storage } from "../storage";
import { authenticateRequest, requireRole } from "../auth";
import { logger } from "../logger";
import { param } from "../utils";
import { calculateLineItemPrice, calculateEstimateTotals, validateEstimate } from "../estimateEngine";

export function pricingRouter() {
  const router = Router();

  router.get("/catalog", authenticateRequest, async (req, res) => {
    try {
      const items = await storage.getScopeLineItems();
      res.json(items);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/catalog/search", authenticateRequest, async (req, res) => {
    try {
      const q = (req.query.q as string || "").toLowerCase();
      if (!q) {
        return res.status(400).json({ message: "q parameter required" });
      }
      const allItems = await storage.getScopeLineItems();
      const filtered = allItems.filter(item =>
        item.code.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
      );
      res.json(filtered);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/catalog/:tradeCode", authenticateRequest, async (req, res) => {
    try {
      const tradeCode = param(req.params.tradeCode);
      const items = await storage.getScopeLineItemsByTrade(tradeCode);
      res.json(items);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/scope", authenticateRequest, async (req, res) => {
    try {
      const { items, regionId, taxRate, overheadPercent, profitPercent } = req.body;

      let effectiveRegion = regionId;
      let effectiveTaxRate = taxRate;
      let effectiveOverhead = overheadPercent;
      let effectiveProfit = profitPercent;

      if (!effectiveRegion || effectiveTaxRate == null || effectiveOverhead == null || effectiveProfit == null) {
        const userSettings = await storage.getUserSettings(req.user!.id);
        const s = userSettings?.settings as Record<string, any> | undefined;
        if (s) {
          if (!effectiveRegion) effectiveRegion = s.defaultRegion || 'US_NATIONAL';
          if (effectiveTaxRate == null) effectiveTaxRate = s.defaultTaxRate ?? 0.08;
          if (effectiveOverhead == null) effectiveOverhead = s.defaultOverheadPercent != null ? s.defaultOverheadPercent / 100 : undefined;
          if (effectiveProfit == null) effectiveProfit = s.defaultProfitPercent != null ? s.defaultProfitPercent / 100 : undefined;
        }
      }

      effectiveRegion = effectiveRegion || 'US_NATIONAL';
      effectiveTaxRate = effectiveTaxRate ?? 0.08;

      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ message: "items array required" });
      }

      const pricedItems = [];

      for (const item of items) {
        const catalogItem = await storage.getScopeLineItemByCode(item.code);
        if (!catalogItem) {
          return res.status(404).json({ message: `Catalog item ${item.code} not found` });
        }
        const regionalPrice = await storage.getRegionalPrice(item.code, effectiveRegion, "install");
        if (!regionalPrice) {
          return res.status(404).json({ message: `Regional price for ${item.code} in region ${effectiveRegion} not found` });
        }
        const priced = calculateLineItemPrice(catalogItem, regionalPrice, item.quantity, item.wasteFactor);
        pricedItems.push(priced);
      }

      const totals = calculateEstimateTotals(pricedItems, effectiveTaxRate, effectiveOverhead, effectiveProfit);

      res.json({ items: pricedItems, totals, appliedSettings: { region: effectiveRegion, taxRate: effectiveTaxRate } });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/validate", authenticateRequest, async (req, res) => {
    try {
      const { items } = req.body;
      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ message: "items array required" });
      }

      const validation = await validateEstimate(items);

      res.json(validation);
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.get("/regions", authenticateRequest, async (req, res) => {
    try {
      const allPrices = await storage.getRegionalPricesForRegion("US_NATIONAL");
      const regions = new Set(allPrices.map(p => p.regionId));
      res.json({
        regions: Array.from(regions).sort(),
        available: Array.from(regions).length > 0,
      });
    } catch (error: any) {
      logger.apiError(req.method, req.path, error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  router.post("/seed", authenticateRequest, requireRole("admin"), async (_req, res) => {
    res.json({ message: "Seed endpoint disabled — only Xactimate data is used" });
  });

  return router;
}

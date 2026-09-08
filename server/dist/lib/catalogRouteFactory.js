import { z } from 'zod';
/**
 * Factory to create reusable catalog route handlers
 * Reduces duplication across catalog endpoints (clients, departments, skills, cities)
 * Each handler can be used with custom middleware as needed
 */
export class CatalogHandlers {
    config;
    capitalizedEntity;
    baseCreateSchema;
    constructor(config) {
        this.config = config;
        this.capitalizedEntity = config.entityName.charAt(0).toUpperCase() + config.entityName.slice(1);
        // Create base schema
        this.baseCreateSchema = z.object({
            name: z
                .string()
                .min(config.nameValidation?.minLength || 1, `${this.capitalizedEntity} name is required`)
                .max(config.nameValidation?.maxLength || 120),
        });
    }
    /**
     * Handler for GET / - List all items in catalog
     */
    list = async (_req, res) => {
        try {
            const items = await this.config.listItems();
            res.json(items);
        }
        catch (error) {
            res.status(500).json({ error: `Failed to list ${this.config.entityName}s` });
        }
    };
    /**
     * Handler for POST / - Create a new catalog item
     */
    create = async (req, res) => {
        try {
            const body = this.baseCreateSchema.parse(req.body);
            const name = body.name.trim().replace(/\s+/g, ' ');
            // Check for existing item
            const existing = await this.config.prismaModel.findFirst({
                where: { name: { equals: name, mode: 'insensitive' } },
            });
            if (existing) {
                return res.status(409).json({
                    error: `This ${this.config.entityName} already exists`,
                    [this.config.entityName]: existing,
                });
            }
            // Prepare data
            let data = { name };
            // Apply custom transformation if provided
            if (this.config.transformData) {
                const extra = this.config.transformData(body);
                data = { ...data, ...extra };
            }
            else if (this.config.extraFieldsSchema && body.extra) {
                data = { ...data, ...body.extra };
            }
            // Create the item
            const row = await this.config.prismaModel.create({ data });
            this.config.invalidateCache();
            res.status(201).json(row);
        }
        catch (error) {
            if (error.name === 'ZodError') {
                return res.status(400).json({ error: 'Invalid request body', details: error.errors });
            }
            res.status(500).json({ error: `Failed to create ${this.config.entityName}` });
        }
    };
    /**
     * Handler for DELETE /:id - Remove an item from the catalog
     */
    delete = async (req, res) => {
        try {
            const row = await this.config.prismaModel.findUnique({ where: { id: req.params.id } });
            if (!row) {
                return res.status(404).json({ error: `${this.capitalizedEntity} not found` });
            }
            await this.config.prismaModel.delete({ where: { id: row.id } });
            this.config.invalidateCache();
            res.status(204).send();
        }
        catch (error) {
            res.status(500).json({ error: `Failed to delete ${this.config.entityName}` });
        }
    };
    /**
     * Handler for POST /seed-defaults - Reset defaults
     */
    seedDefaults = async (_req, res) => {
        try {
            if (!this.config.resetDefaults || !this.config.syncDefaults) {
                return res.status(400).json({ error: `Cannot reset ${this.config.entityName}s` });
            }
            await this.config.resetDefaults();
            const added = await this.config.syncDefaults();
            const items = await this.config.listItems();
            res.json({ added, count: items.length, [`${this.config.entityName}s`]: items });
        }
        catch (error) {
            res.status(500).json({ error: `Failed to reset ${this.config.entityName}s` });
        }
    };
}

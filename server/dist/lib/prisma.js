import { Prisma, PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient();
/** Ensures generated client matches schema (new models require db:generate + API restart). */
export function assertPrismaClientModels() {
    const client = prisma;
    if (!client.interviewPlan?.findUnique) {
        throw new Error('Prisma client is out of date (missing interviewPlan). Stop the API, run `npm run db:generate --prefix server`, then restart.');
    }
    if (!client.clientCatalog?.count) {
        throw new Error('Prisma client is out of date (missing clientCatalog). Stop the API, run `npm run db:generate --prefix server`, then restart `npm run dev`.');
    }
    if (!client.interviewPanelLevel?.findUnique) {
        throw new Error('Prisma client is out of date (missing interviewPanelLevel). Stop the API, run `npm run db:generate --prefix server`, then restart `npm run dev`.');
    }
    const client3 = prisma;
    if (!client3.clientDeal?.findMany) {
        throw new Error('Prisma client is out of date (missing clientDeal). Stop the API, run `npm run db:generate --prefix server`, then restart `npm run dev`.');
    }
    const client4 = prisma;
    if (!client4.skillMarketRow?.findMany || !client4.locationMultiplier?.findMany) {
        throw new Error('Prisma client is out of date (missing skillMarketRow/locationMultiplier). Stop the API, run `npm run db:generate --prefix server`, then restart `npm run dev`.');
    }
    const clientDealFields = Prisma.dmmf.datamodel.models.find((m) => m.name === 'ClientDeal')?.fields;
    if (!clientDealFields?.some((f) => f.name === 'sowGatewayReached')) {
        throw new Error('Prisma client is out of date (missing ClientDeal.sowGatewayReached). Stop the API, run `npm run db:generate --prefix server`, then restart `npm run dev`.');
    }
    const client5 = prisma;
    if (!client5.vendorOnboarding?.findUnique) {
        throw new Error('Prisma client is out of date (missing vendorOnboarding). Stop the API, run `npm run db:generate --prefix server`, then restart `npm run dev`.');
    }
    const client6 = prisma;
    if (!client6.refreshToken?.findUnique) {
        throw new Error('Prisma client is out of date (missing refreshToken). Stop the API, run `npm run db:generate --prefix server`, then restart `npm run dev`.');
    }
}

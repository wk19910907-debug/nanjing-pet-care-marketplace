import { z } from 'zod';

export const NANJING_DISTRICTS = [
  { code: 'JIANYE', name: '建邺区' },
  { code: 'GULOU', name: '鼓楼区' },
  { code: 'XUANWU', name: '玄武区' },
  { code: 'QINHUAI', name: '秦淮区' },
] as const;

export const NanjingDistrictCodeSchema = z.enum(
  NANJING_DISTRICTS.map(({ code }) => code) as [
    typeof NANJING_DISTRICTS[number]['code'],
    ...Array<typeof NANJING_DISTRICTS[number]['code']>,
  ],
);

const CatalogServiceSchema = z.object({
  enabled: z.boolean(),
  basePriceFen: z.int().min(1).max(100_000),
}).strict();

const OpenDistrictsSchema = z.array(NanjingDistrictCodeSchema)
  .min(1)
  .max(NANJING_DISTRICTS.length)
  .refine((codes) => new Set(codes).size === codes.length, 'Districts must be unique');

export const PublicOperationsCatalogSchema = z.object({
  services: z.object({
    CAT_FEEDING: CatalogServiceSchema,
    DOG_WALKING: CatalogServiceSchema,
  }).strict(),
  openDistricts: OpenDistrictsSchema,
  announcement: z.string().trim().max(120),
}).strict();

export const AdminOperationsCatalogSchema = PublicOperationsCatalogSchema.extend({
  version: z.int().positive(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export const OperationsCatalogUpdateSchema = PublicOperationsCatalogSchema.extend({
  expectedVersion: z.int().positive(),
}).strict();

export type NanjingDistrictCode = z.infer<typeof NanjingDistrictCodeSchema>;
export type PublicOperationsCatalog = z.infer<typeof PublicOperationsCatalogSchema>;
export type AdminOperationsCatalog = z.infer<typeof AdminOperationsCatalogSchema>;
export type OperationsCatalogUpdate = z.infer<typeof OperationsCatalogUpdateSchema>;

export const DEFAULT_OPERATIONS_CATALOG: PublicOperationsCatalog = {
  services: {
    CAT_FEEDING: { enabled: true, basePriceFen: 3_200 },
    DOG_WALKING: { enabled: true, basePriceFen: 3_700 },
  },
  openDistricts: NANJING_DISTRICTS.map(({ code }) => code),
  announcement: '',
};

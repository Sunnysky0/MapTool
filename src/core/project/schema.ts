import { z } from 'zod';

const finiteNumber = z.number().finite();
const color = z.string().min(1, 'Color must not be empty.');
const longitude = finiteNumber.min(-180).max(180);
const latitude = finiteNumber.min(-90).max(90);

export const calibrationSnapshotSchema = z
  .object({
    version: z.literal(1),
    method: z.literal('artistic-plate-carree'),
    xMin: finiteNumber,
    xMax: finiteNumber,
    yMin: finiteNumber,
    yMax: finiteNumber,
    longitudeRange: z.tuple([z.literal(-180), z.literal(180)]),
    latitudeRange: z.tuple([z.literal(-90), z.literal(90)]),
    yAxis: z.literal('down'),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.xMin >= value.xMax) {
      context.addIssue({
        code: 'custom',
        path: ['xMax'],
        message: 'xMax must be greater than xMin.',
      });
    }
    if (value.yMin >= value.yMax) {
      context.addIssue({
        code: 'custom',
        path: ['yMax'],
        message: 'yMax must be greater than yMin.',
      });
    }
  });

export const geographicExtentSchema = z
  .object({
    west: longitude,
    east: longitude,
    south: latitude,
    north: latitude,
    wrapsAntimeridian: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.south >= value.north) {
      context.addIssue({
        code: 'custom',
        path: ['north'],
        message: 'north must be greater than south.',
      });
    }
    if (value.wrapsAntimeridian && value.west <= value.east) {
      context.addIssue({
        code: 'custom',
        path: ['wrapsAntimeridian'],
        message: 'A wrapped extent must have west greater than east.',
      });
    }
    if (!value.wrapsAntimeridian && value.west >= value.east) {
      context.addIssue({
        code: 'custom',
        path: ['east'],
        message: 'A non-wrapped extent must have east greater than west.',
      });
    }
  });

const projectionParameterSchema = z.union([finiteNumber, z.boolean(), z.string()]);

export const mapDocumentSchema = z
  .object({
    source: z
      .object({
        file: z.string().min(1),
        sha256: z.string().regex(/^[a-fA-F0-9]{64}$/, 'Expected a 64-character SHA-256 hash.'),
        calibration: calibrationSnapshotSchema,
      })
      .strict(),
    extent: geographicExtentSchema,
    projection: z
      .object({
        id: z.string().min(1),
        parameters: z.record(z.string(), projectionParameterSchema),
      })
      .strict(),
    canvas: z
      .object({
        width: finiteNumber.int().min(1).max(8192),
        height: finiteNumber.int().min(1).max(8192),
        padding: finiteNumber.min(0).max(4096),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.padding * 2 >= Math.min(value.width, value.height)) {
          context.addIssue({
            code: 'custom',
            path: ['padding'],
            message: 'padding must leave a positive drawable area.',
          });
        }
      }),
    style: z
      .object({
        linework: z
          .object({
            color,
            width: finiteNumber.positive(),
            opacity: finiteNumber.min(0).max(1),
            lineCap: z.enum(['butt', 'round', 'square']),
            lineJoin: z.enum(['bevel', 'round', 'miter']),
          })
          .strict(),
        graticule: z
          .object({
            visible: z.boolean(),
            longitudeInterval: finiteNumber.positive().max(360),
            latitudeInterval: finiteNumber.positive().max(180),
            color,
            width: finiteNumber.positive(),
            opacity: finiteNumber.min(0).max(1),
          })
          .strict(),
        background: z.object({ color: color.nullable() }).strict(),
        extentFrame: z
          .object({ visible: z.boolean(), color, width: finiteNumber.positive() })
          .strict(),
      })
      .strict(),
    exportQuality: z.enum(['preview', 'standard', 'high']),
  })
  .strict();

export const projectFileV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    document: mapDocumentSchema,
  })
  .strict();

export type ProjectFileV1 = z.infer<typeof projectFileV1Schema>;

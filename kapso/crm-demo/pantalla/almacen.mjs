// Almacenamiento de los documentos que el cliente sube por el formulario (S3, privado).
// El navegador sube y baja cada archivo directo a S3 con una direccion firmada de pocos minutos;
// los archivos nunca pasan por este programa.
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const MINUTOS_PARA_SUBIR = 10;
const MINUTOS_PARA_VER = 5;

export function crearAlmacen(deposito) {
  // Sin esta opcion el SDK firma una suma de verificacion de un cuerpo vacio y S3 rechaza la subida del navegador.
  const s3 = new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED' });
  return {
    direccionParaSubir: (ruta, tipo) =>
      getSignedUrl(s3, new PutObjectCommand({ Bucket: deposito, Key: ruta, ContentType: tipo }), {
        expiresIn: MINUTOS_PARA_SUBIR * 60,
        // El tipo queda firmado: la direccion solo sirve para subir un archivo de ese tipo.
        signableHeaders: new Set(['content-type']),
      }),
    direccionParaVer: (ruta) =>
      getSignedUrl(s3, new GetObjectCommand({ Bucket: deposito, Key: ruta, ResponseContentDisposition: 'attachment' }), { expiresIn: MINUTOS_PARA_VER * 60 }),
    leer: async (ruta) => Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: deposito, Key: ruta }))).Body.transformToByteArray()),
    /** Tamano del archivo en bytes, o null si no existe. */
    tamano: async (ruta) => {
      try {
        return (await s3.send(new HeadObjectCommand({ Bucket: deposito, Key: ruta }))).ContentLength ?? 0;
      } catch (error) {
        if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },
  };
}

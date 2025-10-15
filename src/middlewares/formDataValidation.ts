// import { Request, Response, NextFunction } from 'express';
// import { validate, ValidationError } from 'class-validator';
// import { plainToClass } from 'class-transformer';
// import { FirebaseStorageService } from '../services/firebaseStorage';

/**
 * Middleware de validación de FormData usando class-validator
 * @param dtoClass - La clase DTO que define las reglas de validación
 * @param options - Opciones de validación
 * @returns Middleware de Express
 */
// export function validateFormData<T extends object>(
//   dtoClass: new () => T,
//   options: {
//     skipMissingProperties?: boolean;
//     whitelist?: boolean;
//     forbidNonWhitelisted?: boolean;
//     forbidUnknownValues?: boolean;
//     allowedFileFields?: string[];
//     maxFileSize?: number;
//     allowedFileTypes?: string[];
//     fileFieldMap?: Record<string, string>;
//   } = {}
// ) {
//   return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
//     try {
//       // Extraer datos del FormData
//       const formData = req.body;
//       const files = req.files as { [fieldname: string]: Express.Multer.File[] };

//       // Crear objeto para validación (sin archivos)
//       const validationObject: any = { ...formData };

//       // Procesar archivos si existen
//       if (files && Object.keys(files).length > 0) {
//         const allowedFileFields = options.allowedFileFields || ['logo', 'banner', 'image'];
//         const maxFileSize = options.maxFileSize || 5 * 1024 * 1024; // 5MB por defecto
//         const allowedFileTypes = options.allowedFileTypes || ['jpg', 'jpeg', 'png', 'gif', 'webp'];

//         for (const [fieldName, fileArray] of Object.entries(files)) {
//           if (allowedFileFields.includes(fieldName) && fileArray.length > 0) {
//             const file = fileArray[0]; // Tomar el primer archivo

//             // Validar tipo de archivo
//             if (!FirebaseStorageService.validateFileType(file.originalname, allowedFileTypes)) {
//               res.status(400).json({
//                 success: false,
//                 message: 'Error de validación',
//                 errors: {
//                   [fieldName]: [`Tipo de archivo no permitido. Tipos permitidos: ${allowedFileTypes.join(', ')}`]
//                 }
//               });
//               return;
//             }

//             // Validar tamaño de archivo
//             if (!FirebaseStorageService.validateFileSize(file.size, maxFileSize)) {
//               res.status(400).json({
//                 success: false,
//                 message: 'Error de validación',
//                 errors: {
//                   [fieldName]: [`El archivo es demasiado grande. Tamaño máximo: ${Math.round(maxFileSize / 1024 / 1024)}MB`]
//                 }
//               });
//               return;
//             }

//             // Subir archivo a Firebase Storage
//             try {
//               const uploadResult = await FirebaseStorageService.uploadFile(
//                 file.buffer,
//                 file.originalname,
//                 'catalogs',
//                 file.mimetype
//               );
//               console.log(uploadResult)

//               // Agregar la URL del archivo al objeto de validación
//               validationObject[options.fileFieldMap[fieldName]] = uploadResult.url;
//             } catch (uploadError) {
//               console.error('Error al subir archivo:', uploadError);
//               res.status(500).json({
//                 success: false,
//                 message: 'Error al subir archivo'
//               });
//               return;
//             }
//           }
//         }
//       }

//       // Convertir el objeto a una instancia de la clase DTO
//       const dtoObject = plainToClass(dtoClass, validationObject, {
//         excludeExtraneousValues: options.forbidNonWhitelisted || false,
//         enableImplicitConversion: true
//       });

//       // Validar el objeto usando class-validator
//       const errors = await validate(dtoObject, {
//         skipMissingProperties: options.skipMissingProperties || false,
//         whitelist: options.whitelist || true,
//         forbidNonWhitelisted: options.forbidNonWhitelisted || false,
//         forbidUnknownValues: options.forbidUnknownValues || false
//       });

//       // Si hay errores de validación, devolver respuesta de error
//       if (errors.length > 0) {
//         const validationErrors = formatValidationErrors(errors);
        
//         res.status(400).json({
//           success: false,
//           message: 'Error de validación',
//           errors: validationErrors
//         });
//         return;
//       }

//       // Si la validación pasa, asignar el objeto validado al body
//       req.body = dtoObject;
//       next();
//     } catch (error) {
//       console.error('Error en validación de FormData:', error);
//       res.status(500).json({
//         success: false,
//         message: 'Error interno en validación'
//       });
//     }
//   };
// }

// /**
//  * Middleware de validación de FormData para operaciones de creación
//  * Permite propiedades opcionales y no requiere campos específicos
//  */
// export function validateCreateFormData<T extends object>(
//   dtoClass: new () => T,
//   options: {
//     allowedFileFields?: string[];
//     maxFileSize?: number;
//     allowedFileTypes?: string[];
//     fileFieldMap?: Record<string, string>;
//   } = {}
// ) {
//   return validateFormData(dtoClass, {
//     skipMissingProperties: true,
//     whitelist: true,
//     forbidNonWhitelisted: false,
//     fileFieldMap: options.fileFieldMap || {},
//     ...options
//   });
// }

// /**
//  * Middleware de validación de FormData para operaciones de actualización
//  * Permite actualizaciones parciales
//  */
// export function validateUpdateFormData<T extends object>(
//   dtoClass: new () => T,
//   options: {
//     allowedFileFields?: string[];
//     maxFileSize?: number;
//     allowedFileTypes?: string[];
//   } = {}
// ) {
//   return validateFormData(dtoClass, {
//     skipMissingProperties: true,
//     whitelist: true,
//     forbidNonWhitelisted: false,
//     ...options
//   });
// }

// /**
//  * Middleware de validación estricta de FormData
//  * Requiere todos los campos y no permite propiedades extra
//  */
// export function validateStrictFormData<T extends object>(
//   dtoClass: new () => T,
//   options: {
//     allowedFileFields?: string[];
//     maxFileSize?: number;
//     allowedFileTypes?: string[];
//   } = {}
// ) {
//   return validateFormData(dtoClass, {
//     skipMissingProperties: false,
//     whitelist: true,
//     forbidNonWhitelisted: true,
//     forbidUnknownValues: true,
//     ...options
//   });
// }

// /**
//  * Formatea los errores de validación en un formato legible
//  */
// function formatValidationErrors(errors: ValidationError[]): Record<string, string[]> {
//   const formattedErrors: Record<string, string[]> = {};

//   errors.forEach(error => {
//     if (error.constraints) {
//       formattedErrors[error.property] = Object.values(error.constraints);
//     }
    
//     // Manejar errores anidados
//     if (error.children && error.children.length > 0) {
//       const nestedErrors = formatValidationErrors(error.children);
//       Object.keys(nestedErrors).forEach(key => {
//         formattedErrors[`${error.property}.${key}`] = nestedErrors[key];
//       });
//     }
//   });

//   return formattedErrors;
// } 
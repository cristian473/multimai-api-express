import { Request, Response, NextFunction } from 'express';
import { validate, ValidationError } from 'class-validator';
import { plainToClass } from 'class-transformer';

/**
 * Middleware de validación de body usando class-validator
 * @param dtoClass - La clase DTO que define las reglas de validación
 * @param options - Opciones de validación
 * @returns Middleware de Express
 */
export function validateBody<T extends object>(
  dtoClass: new () => T,
  options: {
    skipMissingProperties?: boolean;
    whitelist?: boolean;
    forbidNonWhitelisted?: boolean;
    forbidUnknownValues?: boolean;
  } = {}
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Convertir el body a una instancia de la clase DTO
      const dtoObject = plainToClass(dtoClass, req.body, {
        excludeExtraneousValues: options.forbidNonWhitelisted || false,
        enableImplicitConversion: true
      });

      // Validar el objeto usando class-validator
      const errors = await validate(dtoObject, {
        skipMissingProperties: options.skipMissingProperties || false,
        whitelist: options.whitelist || true,
        forbidNonWhitelisted: options.forbidNonWhitelisted || false,
        forbidUnknownValues: options.forbidUnknownValues || false
      });

      // Si hay errores de validación, devolver respuesta de error
      if (errors.length > 0) {
        const validationErrors = formatValidationErrors(errors);
        
        res.status(400).json({
          success: false,
          message: 'Error de validación',
          errors: validationErrors
        });
        return;
      }

      // Si la validación pasa, asignar el objeto validado al body
      req.body = dtoObject;
      next();
    } catch (error) {
      console.error('Error en validación de body:', error);
      res.status(500).json({
        success: false,
        message: 'Error interno en validación'
      });
    }
  };
}

/**
 * Middleware de validación de body para operaciones de creación
 * Permite propiedades opcionales y no requiere campos específicos
 */
export function validateCreateBody<T extends object>(dtoClass: new () => T) {
  return validateBody(dtoClass, {
    skipMissingProperties: true,
    whitelist: true,
    forbidNonWhitelisted: false
  });
}

/**
 * Middleware de validación de body para operaciones de actualización
 * Permite actualizaciones parciales
 */
export function validateUpdateBody<T extends object>(dtoClass: new () => T) {
  return validateBody(dtoClass, {
    skipMissingProperties: true,
    whitelist: true,
    forbidNonWhitelisted: false
  });
}

/**
 * Middleware de validación estricta de body
 * Requiere todos los campos y no permite propiedades extra
 */
export function validateStrictBody<T extends object>(dtoClass: new () => T) {
  return validateBody(dtoClass, {
    skipMissingProperties: false,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true
  });
}

/**
 * Formatea los errores de validación en un formato legible
 */
function formatValidationErrors(errors: ValidationError[]): Record<string, string[]> {
  const formattedErrors: Record<string, string[]> = {};

  errors.forEach(error => {
    if (error.constraints) {
      formattedErrors[error.property] = Object.values(error.constraints);
    }
    
    // Manejar errores anidados
    if (error.children && error.children.length > 0) {
      const nestedErrors = formatValidationErrors(error.children);
      Object.keys(nestedErrors).forEach(key => {
        formattedErrors[`${error.property}.${key}`] = nestedErrors[key];
      });
    }
  });

  return formattedErrors;
}

/**
 * Decorador para aplicar validación a rutas específicas
 * @param dtoClass - La clase DTO para validación
 * @param options - Opciones de validación
 */
export function ValidateBody<T extends object>(
  dtoClass: new () => T,
  options?: {
    skipMissingProperties?: boolean;
    whitelist?: boolean;
    forbidNonWhitelisted?: boolean;
    forbidUnknownValues?: boolean;
  }
) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = function (...args: any[]) {
      const req = args[0] as Request;
      const res = args[1] as Response;
      const next = args[2] as NextFunction;
      
      validateBody(dtoClass, options)(req, res, next);
    };
    
    return descriptor;
  };
}

/**
 * Decorador para validación de creación
 */
export function ValidateCreate<T extends object>(dtoClass: new () => T) {
  return ValidateBody(dtoClass, {
    skipMissingProperties: true,
    whitelist: true,
    forbidNonWhitelisted: false
  });
}

/**
 * Decorador para validación de actualización
 */
export function ValidateUpdate<T extends object>(dtoClass: new () => T) {
  return ValidateBody(dtoClass, {
    skipMissingProperties: true,
    whitelist: true,
    forbidNonWhitelisted: false
  });
}

/**
 * Decorador para validación estricta
 */
export function ValidateStrict<T extends object>(dtoClass: new () => T) {
  return ValidateBody(dtoClass, {
    skipMissingProperties: false,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true
  });
} 
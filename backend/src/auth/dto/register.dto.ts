import { IsEmail, IsString, ValidateIf, MinLength, MaxLength } from 'class-validator';

export class RegisterDto {
  // At least one of email/phone is required — enforced in AuthService.register,
  // since class-validator has no clean built-in for "either of these two fields".
  // @ValidateIf (not @IsOptional) because forms send '' rather than omitting the
  // key when a field is left blank, and @IsOptional only skips null/undefined —
  // an empty string would still hit @IsEmail()/@MinLength() and fail validation.
  @ValidateIf((o) => !!o.email)
  @IsEmail()
  email?: string;

  @ValidateIf((o) => !!o.phone)
  @IsString()
  @MinLength(6)
  @MaxLength(30)
  phone?: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  role: string;
}

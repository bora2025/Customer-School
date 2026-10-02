import { IsEmail, IsString, Length, MinLength } from 'class-validator';

export class RequestPasswordResetDto {
  @IsEmail()
  email!: string;
}

export class ConfirmPasswordResetDto {
  @IsString()
  @Length(64, 64)
  token!: string;

  @IsString()
  @MinLength(12)
  newPassword!: string;
}

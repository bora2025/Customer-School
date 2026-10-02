import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class LoginDto {
  // Email address or phone number — AuthService.validateUser routes to whichever
  // column matches (looksLikeEmail), so this can't be a strict @IsEmail() check.
  @IsString()
  @MinLength(3)
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?:\d{6}|[A-Fa-f0-9]{10})$/)
  mfaCode?: string;
}

import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class InstallDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  @Matches(/\S/, { message: 'schoolName must contain a non-whitespace character' })
  schoolName: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'schoolSlug must contain lowercase letters, numbers, and single hyphens only',
  })
  @MaxLength(80)
  schoolSlug: string;

  @IsString()
  @Matches(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
  locale: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  timezone: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/\S/, { message: 'ownerName must contain a non-whitespace character' })
  ownerName: string;

  @IsEmail()
  @MaxLength(254)
  ownerEmail: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'ownerPassword must contain at least one letter and one number',
  })
  ownerPassword: string;

  /** Informational only -- DEC-001 (core license) is still `proposed`; recorded when provided, never required. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  acceptedLicenseVersion?: string;

}

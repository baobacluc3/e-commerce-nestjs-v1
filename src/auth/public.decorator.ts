import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Every route needs a valid access token unless it is marked with @Public().
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

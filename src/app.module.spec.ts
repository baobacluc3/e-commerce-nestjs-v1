import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

describe('AppModule', () => {
  it('compiles', async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await module.close();
  });
});

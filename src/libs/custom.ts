export function generateRandomNumber(length: number): string {
    const characters = '0123456789';
  
    return Array.from({ length }).reduce((prev: string) => prev + characters.charAt(Math.floor(Math.random() * characters.length)), '');
  }
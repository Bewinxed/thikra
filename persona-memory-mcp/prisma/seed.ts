import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // Seed EmotionTypes based on Plutchik's Wheel
  // Reference: https://en.wikipedia.org/wiki/Robert_Plutchik
  const emotionTypes = [
    // Joy spectrum
    {
      primaryEmotion: 'joy',
      intensityLevel: 1,
      emotionName: 'serenity',
      pleasureComponent: 0.6,
      arousalComponent: 0.3,
      dominanceComponent: 0.5,
    },
    {
      primaryEmotion: 'joy',
      intensityLevel: 2,
      emotionName: 'joy',
      pleasureComponent: 0.8,
      arousalComponent: 0.6,
      dominanceComponent: 0.6,
    },
    {
      primaryEmotion: 'joy',
      intensityLevel: 3,
      emotionName: 'ecstasy',
      pleasureComponent: 1.0,
      arousalComponent: 0.9,
      dominanceComponent: 0.7,
    },

    // Trust spectrum
    {
      primaryEmotion: 'trust',
      intensityLevel: 1,
      emotionName: 'acceptance',
      pleasureComponent: 0.5,
      arousalComponent: 0.2,
      dominanceComponent: 0.4,
    },
    {
      primaryEmotion: 'trust',
      intensityLevel: 2,
      emotionName: 'trust',
      pleasureComponent: 0.6,
      arousalComponent: 0.3,
      dominanceComponent: 0.5,
    },
    {
      primaryEmotion: 'trust',
      intensityLevel: 3,
      emotionName: 'admiration',
      pleasureComponent: 0.7,
      arousalComponent: 0.5,
      dominanceComponent: 0.3,
    },

    // Fear spectrum
    {
      primaryEmotion: 'fear',
      intensityLevel: 1,
      emotionName: 'apprehension',
      pleasureComponent: -0.3,
      arousalComponent: 0.4,
      dominanceComponent: -0.3,
    },
    {
      primaryEmotion: 'fear',
      intensityLevel: 2,
      emotionName: 'fear',
      pleasureComponent: -0.6,
      arousalComponent: 0.7,
      dominanceComponent: -0.5,
    },
    {
      primaryEmotion: 'fear',
      intensityLevel: 3,
      emotionName: 'terror',
      pleasureComponent: -0.9,
      arousalComponent: 1.0,
      dominanceComponent: -0.8,
    },

    // Surprise spectrum
    {
      primaryEmotion: 'surprise',
      intensityLevel: 1,
      emotionName: 'distraction',
      pleasureComponent: 0.0,
      arousalComponent: 0.5,
      dominanceComponent: 0.0,
    },
    {
      primaryEmotion: 'surprise',
      intensityLevel: 2,
      emotionName: 'surprise',
      pleasureComponent: 0.1,
      arousalComponent: 0.8,
      dominanceComponent: -0.1,
    },
    {
      primaryEmotion: 'surprise',
      intensityLevel: 3,
      emotionName: 'amazement',
      pleasureComponent: 0.3,
      arousalComponent: 0.9,
      dominanceComponent: -0.2,
    },

    // Sadness spectrum
    {
      primaryEmotion: 'sadness',
      intensityLevel: 1,
      emotionName: 'pensiveness',
      pleasureComponent: -0.2,
      arousalComponent: 0.1,
      dominanceComponent: -0.1,
    },
    {
      primaryEmotion: 'sadness',
      intensityLevel: 2,
      emotionName: 'sadness',
      pleasureComponent: -0.5,
      arousalComponent: 0.2,
      dominanceComponent: -0.4,
    },
    {
      primaryEmotion: 'sadness',
      intensityLevel: 3,
      emotionName: 'grief',
      pleasureComponent: -0.8,
      arousalComponent: 0.3,
      dominanceComponent: -0.7,
    },

    // Disgust spectrum
    {
      primaryEmotion: 'disgust',
      intensityLevel: 1,
      emotionName: 'boredom',
      pleasureComponent: -0.2,
      arousalComponent: -0.3,
      dominanceComponent: 0.1,
    },
    {
      primaryEmotion: 'disgust',
      intensityLevel: 2,
      emotionName: 'disgust',
      pleasureComponent: -0.6,
      arousalComponent: 0.3,
      dominanceComponent: 0.3,
    },
    {
      primaryEmotion: 'disgust',
      intensityLevel: 3,
      emotionName: 'loathing',
      pleasureComponent: -0.9,
      arousalComponent: 0.5,
      dominanceComponent: 0.5,
    },

    // Anger spectrum
    {
      primaryEmotion: 'anger',
      intensityLevel: 1,
      emotionName: 'annoyance',
      pleasureComponent: -0.3,
      arousalComponent: 0.4,
      dominanceComponent: 0.4,
    },
    {
      primaryEmotion: 'anger',
      intensityLevel: 2,
      emotionName: 'anger',
      pleasureComponent: -0.6,
      arousalComponent: 0.7,
      dominanceComponent: 0.6,
    },
    {
      primaryEmotion: 'anger',
      intensityLevel: 3,
      emotionName: 'rage',
      pleasureComponent: -0.9,
      arousalComponent: 1.0,
      dominanceComponent: 0.8,
    },

    // Anticipation spectrum
    {
      primaryEmotion: 'anticipation',
      intensityLevel: 1,
      emotionName: 'interest',
      pleasureComponent: 0.3,
      arousalComponent: 0.4,
      dominanceComponent: 0.3,
    },
    {
      primaryEmotion: 'anticipation',
      intensityLevel: 2,
      emotionName: 'anticipation',
      pleasureComponent: 0.4,
      arousalComponent: 0.6,
      dominanceComponent: 0.4,
    },
    {
      primaryEmotion: 'anticipation',
      intensityLevel: 3,
      emotionName: 'vigilance',
      pleasureComponent: 0.2,
      arousalComponent: 0.8,
      dominanceComponent: 0.6,
    },
  ];

  console.log('🎭 Seeding emotion types...');
  for (const emotion of emotionTypes) {
    await prisma.emotionType.upsert({
      where: { emotionName: emotion.emotionName },
      update: {},
      create: emotion,
    });
  }

  // Seed BodyParts with hierarchical structure
  console.log('🦴 Seeding body parts...');

  // Root body parts
  const head = await prisma.bodyPart.upsert({
    where: { partName: 'head' },
    update: {},
    create: { partName: 'head', partCategory: 'major' },
  });

  const torso = await prisma.bodyPart.upsert({
    where: { partName: 'torso' },
    update: {},
    create: { partName: 'torso', partCategory: 'major' },
  });

  const arms = await prisma.bodyPart.upsert({
    where: { partName: 'arms' },
    update: {},
    create: { partName: 'arms', partCategory: 'major' },
  });

  const legs = await prisma.bodyPart.upsert({
    where: { partName: 'legs' },
    update: {},
    create: { partName: 'legs', partCategory: 'major' },
  });

  // Head sub-parts
  const headSubParts = [
    { partName: 'eyes', partCategory: 'facial', parentPartId: head.id },
    { partName: 'nose', partCategory: 'facial', parentPartId: head.id },
    { partName: 'mouth', partCategory: 'facial', parentPartId: head.id },
    { partName: 'lips', partCategory: 'facial', parentPartId: head.id },
    { partName: 'ears', partCategory: 'sensory', parentPartId: head.id },
    { partName: 'hair', partCategory: 'cosmetic', parentPartId: head.id },
  ];

  for (const part of headSubParts) {
    await prisma.bodyPart.upsert({
      where: { partName: part.partName },
      update: {},
      create: part,
    });
  }

  // Torso sub-parts
  const torsoSubParts = [
    { partName: 'chest', partCategory: 'torso_section', parentPartId: torso.id },
    { partName: 'breasts', partCategory: 'torso_feature', parentPartId: torso.id },
    { partName: 'stomach', partCategory: 'torso_section', parentPartId: torso.id },
    { partName: 'back', partCategory: 'torso_section', parentPartId: torso.id },
    { partName: 'waist', partCategory: 'torso_section', parentPartId: torso.id },
    { partName: 'hips', partCategory: 'torso_section', parentPartId: torso.id },
  ];

  for (const part of torsoSubParts) {
    await prisma.bodyPart.upsert({
      where: { partName: part.partName },
      update: {},
      create: part,
    });
  }

  // Seed ClothingTypes
  console.log('👗 Seeding clothing types...');
  const clothingTypes = [
    { typeName: 'sweater', category: 'top', typicalLayer: 2 },
    { typeName: 'shirt', category: 'top', typicalLayer: 1 },
    { typeName: 'dress', category: 'full_body', typicalLayer: 1 },
    { typeName: 'skirt', category: 'bottom', typicalLayer: 1 },
    { typeName: 'pants', category: 'bottom', typicalLayer: 1 },
    { typeName: 'underwear', category: 'undergarment', typicalLayer: 0 },
    { typeName: 'bra', category: 'undergarment', typicalLayer: 0 },
    { typeName: 'socks', category: 'footwear', typicalLayer: 0 },
    { typeName: 'shoes', category: 'footwear', typicalLayer: 1 },
    { typeName: 'collar', category: 'accessory', typicalLayer: null },
  ];

  for (const type of clothingTypes) {
    await prisma.clothingType.upsert({
      where: { typeName: type.typeName },
      update: {},
      create: type,
    });
  }

  // Seed DesireCategories (Maslow's hierarchy inspired)
  console.log('💫 Seeding desire categories...');
  const desireCategories = [
    { level: 1, name: 'physical', description: 'Physical and sensory desires' },
    { level: 2, name: 'emotional', description: 'Emotional connection and security' },
    { level: 3, name: 'social', description: 'Belonging and relationships' },
    { level: 4, name: 'esteem', description: 'Recognition and respect' },
    { level: 5, name: 'self_actualization', description: 'Personal growth and fulfillment' },
  ];

  for (const category of desireCategories) {
    await prisma.desireCategory.upsert({
      where: { name: category.name },
      update: {},
      create: category,
    });
  }

  // Seed BoundaryTypes
  console.log('🛡️ Seeding boundary types...');
  const boundaryTypes = [
    {
      category: 'physical',
      name: 'personal_space',
      description: 'Physical proximity and touch boundaries',
    },
    {
      category: 'physical',
      name: 'intimate_touch',
      description: 'Intimate physical contact boundaries',
    },
    {
      category: 'emotional',
      name: 'emotional_availability',
      description: 'Emotional openness and vulnerability',
    },
    { category: 'emotional', name: 'trust_levels', description: 'Levels of trust and disclosure' },
    {
      category: 'social',
      name: 'public_behavior',
      description: 'Behavior in public or group settings',
    },
    { category: 'communication', name: 'topics', description: 'Conversation topics and depth' },
    {
      category: 'communication',
      name: 'language',
      description: 'Language and expression boundaries',
    },
  ];

  for (const type of boundaryTypes) {
    await prisma.boundaryType.upsert({
      where: { name: type.name },
      update: {},
      create: type,
    });
  }

  console.log('✅ Seed completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

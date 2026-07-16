import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const startOfDay = (offset = 0) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
};

async function main() {
  await prisma.timeBlock.deleteMany();
  await prisma.material.deleteMany();
  await prisma.note.deleteMany();
  await prisma.diaryEntry.deleteMany();
  await prisma.task.deleteMany();

  const today = startOfDay();
  const yesterday = startOfDay(-1);
  const tomorrow = startOfDay(1);

  const tasks = await Promise.all([
    prisma.task.create({
      data: {
        title: "Shape the morning priorities",
        date: today,
        priority: "HIGH",
        urgentScore: 4,
        importanceScore: 5,
        status: "DONE",
        estimateMinutes: 25,
        actualMinutes: 20,
        sortOrder: 1,
        completedAt: new Date()
      }
    }),
    prisma.task.create({
      data: {
        title: "Draft the product dashboard notes",
        date: today,
        priority: "HIGH",
        urgentScore: 3,
        importanceScore: 5,
        deadline: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2),
        status: "IN_PROGRESS",
        estimateMinutes: 60,
        actualMinutes: 35,
        sortOrder: 2
      }
    }),
    prisma.task.create({
      data: {
        title: "Review saved learning materials",
        date: today,
        priority: "MEDIUM",
        urgentScore: 2,
        importanceScore: 3,
        deadline: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 10),
        status: "TODO",
        estimateMinutes: 40,
        sortOrder: 3
      }
    }),
    prisma.task.create({
      data: {
        title: "Plan tomorrow's deep work block",
        date: tomorrow,
        priority: "MEDIUM",
        urgentScore: 1,
        importanceScore: 4,
        deadline: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1),
        status: "TODO",
        estimateMinutes: 30,
        sortOrder: 1
      }
    }),
    prisma.task.create({
      data: {
        title: "Close yesterday's loose ends",
        date: yesterday,
        priority: "LOW",
        urgentScore: 2,
        importanceScore: 2,
        status: "DONE",
        estimateMinutes: 30,
        actualMinutes: 25,
        sortOrder: 1,
        completedAt: yesterday
      }
    })
  ]);

  await prisma.note.createMany({
    data: [
      {
        content: "Keep the dashboard calm. The core loop should be add, complete, reflect, plan.",
        tags: JSON.stringify(["product", "design"]),
        date: today,
        taskId: tasks[1].id
      },
      {
        content: "Try a short review ritual before dinner.",
        tags: JSON.stringify(["habit"]),
        date: today
      }
    ]
  });

  await prisma.diaryEntry.create({
    data: {
      date: today,
      content: "Today feels focused. I want to finish the essential pieces and leave room to reflect.",
      reflection: "What gave me momentum today?",
      mood: 4,
      energy: 4
    }
  });

  await prisma.material.createMany({
    data: [
      {
        title: "Designing calmer tools",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        type: "youtube",
        notes: "Watch for interaction pacing ideas.",
        taskId: tasks[2].id
      },
      {
        title: "Local-first software notes",
        url: "https://www.inkandswitch.com/local-first/",
        type: "article",
        notes: "Useful principles for future hosted sync."
      }
    ]
  });

  await prisma.timeBlock.createMany({
    data: [
      { date: today, startTime: "09:00", endTime: "10:30", title: "Deep work", taskId: tasks[1].id },
      { date: today, startTime: "11:00", endTime: "11:40", title: "Reading block", taskId: tasks[2].id },
      { date: tomorrow, startTime: "09:30", endTime: "11:00", title: "Build next version", taskId: tasks[3].id }
    ]
  });
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

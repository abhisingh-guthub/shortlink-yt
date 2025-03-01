"use server";

import { ApiResponse } from "@/lib/types";
import { ensureHttps, isValidUrl } from "@/lib/utils";
import { custom, z } from "zod";
import { nanoid } from "nanoid";
import { db } from "@/server/db";
import { urls } from "@/server/db/schema";
import { revalidatePath } from "next/cache";
import { auth } from "@/server/auth";

const shortenUrlSchema = z.object({
  url: z.string().refine(isValidUrl, {
    message: "Please enter a valid URL",
  }),
  customCode: z
    .string()
    .max(20, "Custom code must be less than 255 characters")
    .regex(/^[a-zA-Z0-9_-]+$/, "Custom code must be alphanumeric or hyphen")
    .optional()
    .nullable()
    .transform((val) => (val === null || val === "" ? undefined : val)),
});

export async function shortenUrl(formData: FormData): Promise<
  ApiResponse<{
    shortUrl: string;
  }>
> {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    const url = formData.get("url") as string;
    const customCode = formData.get("customCode") as string;

    const validatedFields = shortenUrlSchema.safeParse({
      url,
      customCode: customCode ? customCode : undefined,
    });

    if (!validatedFields.success) {
      return {
        success: false,
        error:
          validatedFields.error.flatten().fieldErrors.url?.[0] ||
          validatedFields.error.flatten().fieldErrors.customCode?.[0] ||
          "Invalid URL",
      };
    }

    const originalUrl = ensureHttps(validatedFields.data.url);

    const shortCode = validatedFields.data.customCode || nanoid(6);

    // check if the short code already exists
    const existingUrl = await db.query.urls.findFirst({
      where: (urls, { eq }) => eq(urls.shortCode, shortCode),
    });

    if (existingUrl) {
      if (validatedFields.data.customCode) {
        return {
          success: false,
          error: "Custom code already exists",
        };
      }
      return shortenUrl(formData);
    }

    await db.insert(urls).values({
      originalUrl,
      shortCode,
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: userId || null,
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const shortUrl = `${baseUrl}/r/${shortCode}`;

    revalidatePath("/");

    return {
      success: true,
      data: { shortUrl },
    };
  } catch (error) {
    console.error("Failed to shorten URL", error);
    return {
      success: false,
      error: "Failed to shorten URL",
    };
  }
}

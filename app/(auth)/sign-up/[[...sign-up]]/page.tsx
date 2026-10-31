import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-16">
      <div className="grid justify-items-center gap-8">
        <div className="text-center">
          <p className="text-sm tracking-[0.18em] text-[#c4a574] uppercase">Drama Studio</p>
          <h1 className="font-display mt-2 text-4xl">Create an account</h1>
        </div>
        <SignUp />
      </div>
    </main>
  );
}

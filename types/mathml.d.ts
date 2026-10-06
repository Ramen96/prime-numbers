// React renders MathML elements (in the MathML namespace) but its TypeScript
// types don't list them. Declares the ones the site uses.
import "react";

type MathMLProps = React.HTMLAttributes<HTMLElement> & {
  display?: "block" | "inline";
  mathvariant?: string;
  stretchy?: "true" | "false";
  form?: "prefix" | "infix" | "postfix";
  width?: string;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      math: MathMLProps;
      mrow: MathMLProps;
      mi: MathMLProps;
      mn: MathMLProps;
      mo: MathMLProps;
      mtext: MathMLProps;
      msup: MathMLProps;
      msub: MathMLProps;
      msubsup: MathMLProps;
      mfrac: MathMLProps;
      msqrt: MathMLProps;
      munderover: MathMLProps;
      mspace: MathMLProps;
    }
  }
}

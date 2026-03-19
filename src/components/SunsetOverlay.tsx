interface Quote {
  text: string;
  author: string;
}

const QUOTES: Quote[] = [
  // Jurgen Klopp
  { text: "If I sit here now and think about what could have been, I would go crazy.", author: "Jurgen Klopp" },
  { text: "The only sign of weakness is when you stop trying.", author: "Jurgen Klopp" },
  { text: "I am a very normal guy. I just happen to have an extraordinary job.", author: "Jurgen Klopp" },
  { text: "We are Liverpool. This means more.", author: "Jurgen Klopp" },
  { text: "Doubters to believers.", author: "Jurgen Klopp" },
  { text: "It is the intensity of the football that makes it so special.", author: "Jurgen Klopp" },
  { text: "I do not need the 10 best players in the world. I need the 10 best for us.", author: "Jurgen Klopp" },
  { text: "The difference between try and triumph is a little umph.", author: "Jurgen Klopp" },
  { text: "In the dressing room after a defeat, that is the real moment.", author: "Jurgen Klopp" },
  { text: "I have never won anything with talent alone. It was always about desire.", author: "Jurgen Klopp" },
  { text: "If you are not excited about it, you will never be successful.", author: "Jurgen Klopp" },
  { text: "It is not about what you have. It is about what you do with it.", author: "Jurgen Klopp" },
  { text: "The best teams are not the ones with the best players but the best attitude.", author: "Jurgen Klopp" },
  { text: "We do not stop when we are tired. We stop when we are done.", author: "Jurgen Klopp" },
  { text: "If you want to do something special, you have to be in the position to do special things.", author: "Jurgen Klopp" },
  { text: "I believe in a path, and I believe in growing together.", author: "Jurgen Klopp" },
  // Bill Shankly
  { text: "The socialism I believe in is everybody working for the same goal and everybody having a share in the rewards.", author: "Bill Shankly" },
  { text: "If you are first you are first. If you are second, you are nothing.", author: "Bill Shankly" },
  { text: "The trouble with referees is that they know the rules, but they do not know the game.", author: "Bill Shankly" },
  { text: "Above all, I would like to be remembered as a man who was selfless, who strove and worried so that others could share the glory.", author: "Bill Shankly" },
  { text: "Some people think football is a matter of life and death. I assure you, it is much more serious than that.", author: "Bill Shankly" },
  { text: "If you cannot make decisions in life, you are a bloody menace.", author: "Bill Shankly" },
  { text: "A lot of football success is in the mind. You must believe you are the best and then make sure that you are.", author: "Bill Shankly" },
  { text: "The key to football is to aim for the best. There is no point in settling for anything less.", author: "Bill Shankly" },
  // Bob Paisley
  { text: "It is not about the long ball or the short ball. It is about the right ball.", author: "Bob Paisley" },
  { text: "I do not know much about tactics, but I know how to pick a team.", author: "Bob Paisley" },
  { text: "Mind you, I have been here during the bad times too. One year we came second.", author: "Bob Paisley" },
  { text: "If you are in the penalty area and do not know what to do with the ball, put it in the net and we will discuss the options later.", author: "Bob Paisley" },
  { text: "What do they know about football in London? We won everything there is to win.", author: "Bob Paisley" },
  { text: "I have always said that any player who comes to us has got to be better than what we have got.", author: "Bob Paisley" },
  { text: "There is no substitute for hard work. None.", author: "Bob Paisley" },
  { text: "The one thing I will never do is buy a player to stop another team getting him.", author: "Bob Paisley" },
];

function getRandomQuote(): Quote {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}

interface SunsetOverlayProps {
  onDismiss: () => void;
}

export default function SunsetOverlay({ onDismiss }: SunsetOverlayProps) {
  const { text, author } = getRandomQuote();

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden sunset-bg">
      <style>{`
        @keyframes sunsetGradient {
          0% { background-position: 50% 0%; }
          100% { background-position: 50% 100%; }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .sunset-bg {
          background: linear-gradient(
            180deg,
            #f5c78e 0%,
            #e8a87c 20%,
            #d4537e 50%,
            #7b4a8e 75%,
            #4a3f6b 100%
          );
          background-size: 100% 300%;
          animation: sunsetGradient 4s ease-out forwards;
        }
        .sunset-quote {
          animation: fadeInUp 1s ease-out 0.5s both;
        }
        .sunset-author {
          animation: fadeInUp 0.8s ease-out 1.2s both;
        }
        .sunset-done {
          animation: fadeIn 0.6s ease-out 3s both;
        }
      `}</style>

      {/* Quote */}
      <div className="max-w-[440px] px-8 text-center">
        <p className="text-[22px] font-light text-white/90 leading-relaxed mb-4 sunset-quote">
          &ldquo;{text}&rdquo;
        </p>
        <p className="text-[13px] text-white/50 font-medium tracking-wider uppercase sunset-author">
          {author}
        </p>
      </div>

      {/* Done button — appears via CSS animation-delay, no setTimeout */}
      <button
        onClick={onDismiss}
        className="mt-12 px-8 py-3 rounded-xl bg-white/15 text-white text-[14px] font-medium cursor-pointer hover:bg-white/25 transition-colors border border-white/20 sunset-done"
      >
        Done
      </button>
    </div>
  );
}

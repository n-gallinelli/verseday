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

  // ── Wisdom rotation (added 2026-05-05) ──────────────────────────────
  // Stoic
  { text: "You have power over your mind — not outside events. Realize this, and you will find strength.", author: "Marcus Aurelius" },
  { text: "Very little is needed to make a happy life; it is all within yourself, in your way of thinking.", author: "Marcus Aurelius" },
  { text: "When you arise in the morning, think of what a precious privilege it is to be alive — to breathe, to think, to enjoy, to love.", author: "Marcus Aurelius" },
  { text: "Waste no more time arguing what a good man should be. Be one.", author: "Marcus Aurelius" },
  { text: "Confine yourself to the present.", author: "Marcus Aurelius" },
  { text: "Look well into thyself; there is a source of strength which will always spring up if thou wilt always look there.", author: "Marcus Aurelius" },
  { text: "The happiness of your life depends upon the quality of your thoughts.", author: "Marcus Aurelius" },
  { text: "Dwell on the beauty of life. Watch the stars, and see yourself running with them.", author: "Marcus Aurelius" },
  { text: "If it is not right, do not do it; if it is not true, do not say it.", author: "Marcus Aurelius" },
  { text: "Accept the things to which fate binds you, and love the people with whom fate brings you together, and do so with all your heart.", author: "Marcus Aurelius" },
  { text: "What stands in the way becomes the way.", author: "Marcus Aurelius" },
  { text: "We suffer more often in imagination than in reality.", author: "Seneca" },
  { text: "While we wait for life, life passes.", author: "Seneca" },
  { text: "It is not the man who has too little, but the man who craves more, that is poor.", author: "Seneca" },
  { text: "Difficulties strengthen the mind, as labor does the body.", author: "Seneca" },
  { text: "As is a tale, so is life: not how long it is, but how good it is, is what matters.", author: "Seneca" },
  { text: "Begin at once to live, and count each separate day as a separate life.", author: "Seneca" },
  { text: "Sometimes even to live is an act of courage.", author: "Seneca" },
  { text: "Luck is what happens when preparation meets opportunity.", author: "Seneca" },
  { text: "He who fears death will never do anything worthy of a living man.", author: "Seneca" },
  { text: "The whole future lies in uncertainty: live immediately.", author: "Seneca" },
  { text: "The mind that is anxious about future events is miserable.", author: "Seneca" },
  { text: "It is the power of the mind to be unconquerable.", author: "Seneca" },
  { text: "He suffers more than necessary, who suffers before it is necessary.", author: "Seneca" },
  { text: "Every new beginning comes from some other beginning's end.", author: "Seneca" },
  { text: "First say to yourself what you would be; and then do what you have to do.", author: "Epictetus" },
  { text: "No man is free who is not master of himself.", author: "Epictetus" },
  { text: "Wealth consists not in having great possessions, but in having few wants.", author: "Epictetus" },
  { text: "It's not what happens to you, but how you react to it that matters.", author: "Epictetus" },
  { text: "He is a wise man who does not grieve for the things which he has not, but rejoices for those which he has.", author: "Epictetus" },
  { text: "Don't explain your philosophy. Embody it.", author: "Epictetus" },
  { text: "He who is not satisfied with a little, is satisfied with nothing.", author: "Epicurus" },
  { text: "It is not what we have, but what we enjoy, that constitutes our abundance.", author: "Epicurus" },
  { text: "Do not spoil what you have by desiring what you have not.", author: "Epicurus" },
  { text: "The greater the difficulty, the more glory in surmounting it. Skillful pilots gain their reputation from storms and tempests.", author: "Epicurus" },

  // Eastern
  { text: "He who is contented is rich.", author: "Lao Tzu" },
  { text: "Nature does not hurry, yet everything is accomplished.", author: "Lao Tzu" },
  { text: "When I let go of what I am, I become what I might be.", author: "Lao Tzu" },
  { text: "The journey of a thousand miles begins with a single step.", author: "Lao Tzu" },
  { text: "Knowing others is intelligence; knowing yourself is true wisdom.", author: "Lao Tzu" },
  { text: "If you are depressed, you are living in the past. If you are anxious, you are living in the future. If you are at peace, you are living in the present.", author: "Lao Tzu" },
  { text: "He who knows others is wise; he who knows himself is enlightened.", author: "Lao Tzu" },
  { text: "To the mind that is still, the whole universe surrenders.", author: "Lao Tzu" },
  { text: "Care about what other people think and you will always be their prisoner.", author: "Lao Tzu" },
  { text: "Music in the soul can be heard by the universe.", author: "Lao Tzu" },
  { text: "Time is a created thing. To say 'I don't have time' is like saying, 'I don't want to.'", author: "Lao Tzu" },
  { text: "Be content with what you have; rejoice in the way things are. When you realize there is nothing lacking, the whole world belongs to you.", author: "Lao Tzu" },
  { text: "If you correct your mind, the rest of your life will fall into place.", author: "Lao Tzu" },
  { text: "A good traveler has no fixed plans and is not intent on arriving.", author: "Lao Tzu" },
  { text: "Silence is a source of great strength.", author: "Lao Tzu" },
  { text: "An ant on the move does more than a dozing ox.", author: "Lao Tzu" },
  { text: "From caring comes courage.", author: "Lao Tzu" },
  { text: "He who controls others may be powerful, but he who has mastered himself is mightier still.", author: "Lao Tzu" },
  { text: "Do not seek to follow in the footsteps of the wise; seek what they sought.", author: "Matsuo Bashō" },
  { text: "What we think, we become.", author: "Buddha" },
  { text: "Peace comes from within. Do not seek it without.", author: "Buddha" },
  { text: "Three things cannot be long hidden: the sun, the moon, and the truth.", author: "Buddha" },
  { text: "The mind is everything. What you think you become.", author: "Buddha" },
  { text: "A jug fills drop by drop.", author: "Buddha" },
  { text: "Do not look for a sanctuary in anyone except your self.", author: "Buddha" },
  { text: "Better than a thousand hollow words is one word that brings peace.", author: "Buddha" },
  { text: "You yourself, as much as anybody in the entire universe, deserve your love and affection.", author: "Buddha" },
  { text: "All that we are is the result of what we have thought.", author: "Buddha" },
  { text: "Holding on to anger is like grasping a hot coal with the intent of throwing it at someone else; you are the one who gets burned.", author: "Buddha" },
  { text: "Just as a candle cannot burn without fire, men cannot live without a spiritual life.", author: "Buddha" },
  { text: "Each morning we are born again. What we do today is what matters most.", author: "Buddha" },
  { text: "Set your heart on doing good. Do it over and over again, and you will be filled with joy.", author: "Buddha" },
  { text: "Be a lamp unto yourself.", author: "Buddha" },
  { text: "We are not given a good life or a bad life. We are given a life. It's up to us to make it good or bad.", author: "Ajahn Brahm" },
  { text: "If you let go a little, you will have a little peace; if you let go a lot, you will have a lot of peace.", author: "Ajahn Chah" },
  { text: "If you propose to speak, always ask yourself: is it true, is it necessary, is it kind?", author: "Sai Baba" },
  { text: "Silence is sometimes the best answer.", author: "Dalai Lama" },
  { text: "Happiness is not something ready made. It comes from your own actions.", author: "Dalai Lama" },
  { text: "When you talk, you are only repeating what you already know. But if you listen, you may learn something new.", author: "Dalai Lama" },
  { text: "If you think you are too small to make a difference, try sleeping with a mosquito.", author: "Dalai Lama" },
  { text: "There is more to life than increasing its speed.", author: "Mahatma Gandhi" },
  { text: "The best way to find yourself is to lose yourself in the service of others.", author: "Mahatma Gandhi" },
  { text: "In a gentle way, you can shake the world.", author: "Mahatma Gandhi" },
  { text: "An ounce of practice is worth more than tons of preaching.", author: "Mahatma Gandhi" },
  { text: "Out beyond ideas of wrongdoing and rightdoing, there is a field. I'll meet you there.", author: "Rumi" },
  { text: "The wound is the place where the Light enters you.", author: "Rumi" },
  { text: "What you seek is seeking you.", author: "Rumi" },
  { text: "Yesterday I was clever, so I wanted to change the world. Today I am wise, so I am changing myself.", author: "Rumi" },
  { text: "Let me not pray to be sheltered from dangers but to be fearless in facing them.", author: "Rabindranath Tagore" },
  { text: "You can't cross the sea merely by standing and staring at the water.", author: "Rabindranath Tagore" },
  { text: "The butterfly counts not months but moments, and has time enough.", author: "Rabindranath Tagore" },
  { text: "Faith is the bird that feels the light when the dawn is still dark.", author: "Rabindranath Tagore" },
  { text: "Reach high, for stars lie hidden in your soul. Dream deep, for every dream precedes the goal.", author: "Rabindranath Tagore" },
  { text: "I slept and dreamt that life was joy. I awoke and saw that life was service. I acted and behold, service was joy.", author: "Rabindranath Tagore" },
  { text: "The quieter you become, the more you can hear.", author: "Ram Dass" },
  { text: "We're all just walking each other home.", author: "Ram Dass" },

  // Greeks
  { text: "The unexamined life is not worth living.", author: "Socrates" },
  { text: "Beware the barrenness of a busy life.", author: "Socrates" },
  { text: "I cannot teach anybody anything. I can only make them think.", author: "Socrates" },
  { text: "Be slow to fall into friendship; but when thou art in, continue firm and constant.", author: "Socrates" },
  { text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: "Will Durant" },
  { text: "Knowing yourself is the beginning of all wisdom.", author: "Aristotle" },
  { text: "Patience is bitter, but its fruit is sweet.", author: "Aristotle" },
  { text: "Excellence is never an accident.", author: "Aristotle" },
  { text: "Pleasure in the job puts perfection in the work.", author: "Aristotle" },
  { text: "Hope is a waking dream.", author: "Aristotle" },
  { text: "It is during our darkest moments that we must focus to see the light.", author: "Aristotle" },
  { text: "Educating the mind without educating the heart is no education at all.", author: "Aristotle" },
  { text: "The greatest wealth is to live content with little.", author: "Plato" },
  { text: "An empty vessel makes the loudest sound.", author: "Plato" },
  { text: "Wise men speak because they have something to say; fools because they have to say something.", author: "Plato" },
  { text: "Music gives a soul to the universe, wings to the mind, flight to the imagination, and life to everything.", author: "Plato" },
  { text: "Time is the wisest counselor of all.", author: "Pericles" },
  { text: "What you leave behind is not what is engraved in stone monuments, but what is woven into the lives of others.", author: "Pericles" },

  // Confucian
  { text: "Life is really simple, but we insist on making it complicated.", author: "Confucius" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "When it is obvious that the goals cannot be reached, don't adjust the goals, adjust the action steps.", author: "Confucius" },
  { text: "Our greatest glory is not in never falling, but in rising every time we fall.", author: "Confucius" },
  { text: "Often, when I am reading a good book, I stop and thank my teacher that taught me to read.", author: "Confucius" },
  { text: "When anger rises, think of the consequences.", author: "Confucius" },
  { text: "He who learns but does not think is lost. He who thinks but does not learn is in great danger.", author: "Confucius" },
  { text: "Real knowledge is to know the extent of one's ignorance.", author: "Confucius" },
  { text: "Everything has beauty, but not everyone sees it.", author: "Confucius" },
  { text: "The man who moves a mountain begins by carrying away small stones.", author: "Confucius" },
  { text: "When you have faults, do not fear to abandon them.", author: "Confucius" },
  { text: "By three methods we may learn wisdom: first, by reflection, which is noblest; second, by imitation, which is easiest; and third, by experience, which is the most bitter.", author: "Confucius" },

  // Existential / Modern Wisdom
  { text: "Between stimulus and response there is a space. In that space is our power to choose our response.", author: "Viktor E. Frankl" },
  { text: "When we are no longer able to change a situation, we are challenged to change ourselves.", author: "Viktor E. Frankl" },
  { text: "Everything can be taken from a man but one thing: the last of the human freedoms — to choose one's attitude in any given set of circumstances.", author: "Viktor E. Frankl" },
  { text: "The privilege of a lifetime is to become who you truly are.", author: "Carl Jung" },
  { text: "Until you make the unconscious conscious, it will direct your life and you will call it fate.", author: "Carl Jung" },
  { text: "I am not what happened to me, I am what I choose to become.", author: "Carl Jung" },
  { text: "He who has a why to live for can bear almost any how.", author: "Friedrich Nietzsche" },
  { text: "And those who were seen dancing were thought to be insane by those who could not hear the music.", author: "Friedrich Nietzsche" },
  { text: "That which does not kill us makes us stronger.", author: "Friedrich Nietzsche" },
  { text: "You have your way. I have my way. As for the right way, the correct way, and the only way, it does not exist.", author: "Friedrich Nietzsche" },

  // American
  { text: "It is not length of life, but depth of life.", author: "Ralph Waldo Emerson" },
  { text: "Finish each day and be done with it. You have done what you could.", author: "Ralph Waldo Emerson" },
  { text: "What lies behind us and what lies before us are tiny matters compared to what lies within us.", author: "Ralph Waldo Emerson" },
  { text: "To be yourself in a world that is constantly trying to make you something else is the greatest accomplishment.", author: "Ralph Waldo Emerson" },
  { text: "Do not go where the path may lead, go instead where there is no path and leave a trail.", author: "Ralph Waldo Emerson" },
  { text: "Adopt the pace of nature: her secret is patience.", author: "Ralph Waldo Emerson" },
  { text: "The only person you are destined to become is the person you decide to be.", author: "Ralph Waldo Emerson" },
  { text: "Once you make a decision, the universe conspires to make it happen.", author: "Ralph Waldo Emerson" },
  { text: "Do not be too timid and squeamish about your actions. All life is an experiment.", author: "Ralph Waldo Emerson" },
  { text: "Write it on your heart that every day is the best day in the year.", author: "Ralph Waldo Emerson" },
  { text: "Our life is frittered away by detail. Simplify, simplify.", author: "Henry David Thoreau" },
  { text: "Go confidently in the direction of your dreams. Live the life you have imagined.", author: "Henry David Thoreau" },
  { text: "It's not what you look at that matters, it's what you see.", author: "Henry David Thoreau" },
  { text: "I have learned that to be with those I like is enough.", author: "Walt Whitman" },
  { text: "Keep your face always toward the sunshine — and shadows will fall behind you.", author: "Walt Whitman" },
  { text: "Be curious, not judgmental.", author: "Walt Whitman" },
  { text: "Resist much, obey little.", author: "Walt Whitman" },
  { text: "I exist as I am, that is enough.", author: "Walt Whitman" },
  { text: "Whatever you are, be a good one.", author: "Abraham Lincoln" },
  { text: "Be kind, for everyone you meet is fighting a hard battle.", author: "Ian Maclaren" },
  { text: "Twenty years from now you will be more disappointed by the things you didn't do than by the ones you did.", author: "H. Jackson Brown Jr." },
  { text: "Life is what happens to us while we are making other plans.", author: "Allen Saunders" },
  { text: "Do what you can, with what you have, where you are.", author: "Theodore Roosevelt" },
  { text: "Comparison is the thief of joy.", author: "Theodore Roosevelt" },
  { text: "I have not failed. I've just found 10,000 ways that won't work.", author: "Thomas Edison" },
  { text: "The most certain way to succeed is always to try just one more time.", author: "Thomas Edison" },
  { text: "We can't help everyone, but everyone can help someone.", author: "Ronald Reagan" },
  { text: "The best way out is always through.", author: "Robert Frost" },
  { text: "In three words I can sum up everything I've learned about life: it goes on.", author: "Robert Frost" },
  { text: "Two roads diverged in a wood, and I — I took the one less traveled by, and that has made all the difference.", author: "Robert Frost" },
  { text: "I took a deep breath and listened to the old brag of my heart: I am, I am, I am.", author: "Sylvia Plath" },
  { text: "And by the way, everything in life is writable about if you have the outgoing guts to do it, and the imagination to improvise.", author: "Sylvia Plath" },
  { text: "I've always believed that you can think positive just as well as you can think negative.", author: "James Baldwin" },
  { text: "Not everything that is faced can be changed, but nothing can be changed until it is faced.", author: "James Baldwin" },
  { text: "I'm not afraid of storms, for I'm learning how to sail my ship.", author: "Louisa May Alcott" },
  { text: "Have regular hours for work and play; make each day both useful and pleasant.", author: "Louisa May Alcott" },
  { text: "Tell me, what is it you plan to do with your one wild and precious life?", author: "Mary Oliver" },
  { text: "Pay attention. Be astonished. Tell about it.", author: "Mary Oliver" },
  { text: "I don't want to end up simply having visited this world.", author: "Mary Oliver" },
  { text: "There is no greater agony than bearing an untold story inside you.", author: "Maya Angelou" },
  { text: "I've learned that people will forget what you said, people will forget what you did, but people will never forget how you made them feel.", author: "Maya Angelou" },
  { text: "We delight in the beauty of the butterfly, but rarely admit the changes it has gone through to achieve that beauty.", author: "Maya Angelou" },
  { text: "Do the best you can until you know better. Then when you know better, do better.", author: "Maya Angelou" },
  { text: "If you don't like something, change it. If you can't change it, change your attitude.", author: "Maya Angelou" },
  { text: "Try to be a rainbow in someone else's cloud.", author: "Maya Angelou" },
  { text: "Just don't give up trying to do what you really want to do. Where there is love and inspiration, I don't think you can go wrong.", author: "Ella Fitzgerald" },
  { text: "How we spend our days is, of course, how we spend our lives.", author: "Annie Dillard" },
  { text: "Beauty and grace are performed whether or not we will or sense them. The least we can do is try to be there.", author: "Annie Dillard" },
  { text: "The world breaks everyone, and afterward, many are strong at the broken places.", author: "Ernest Hemingway" },
  { text: "Courage is grace under pressure.", author: "Ernest Hemingway" },
  { text: "There is nothing noble in being superior to your fellow man; true nobility is being superior to your former self.", author: "Ernest Hemingway" },
  { text: "Almost everything will work again if you unplug it for a few minutes, including you.", author: "Anne Lamott" },
  { text: "Hope begins in the dark, the stubborn hope that if you just show up and try to do the right thing, the dawn will come.", author: "Anne Lamott" },
  { text: "Lighthouses don't go running all over an island looking for boats to save; they just stand there shining.", author: "Anne Lamott" },
  { text: "You own everything that happened to you. Tell your stories.", author: "Anne Lamott" },
  { text: "Sometimes you have to do the right thing twice before it sticks.", author: "Anne Lamott" },
  { text: "You can't stop the waves, but you can learn to surf.", author: "Jon Kabat-Zinn" },
  { text: "Wherever you go, there you are.", author: "Jon Kabat-Zinn" },
  { text: "Give every day the chance to become the most beautiful day of your life.", author: "Mark Twain" },
  { text: "The two most important days in your life are the day you are born and the day you find out why.", author: "Mark Twain" },
  { text: "Kindness is a language which the deaf can hear and the blind can see.", author: "Mark Twain" },
  { text: "Whenever you find yourself on the side of the majority, it is time to pause and reflect.", author: "Mark Twain" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Comparison is the death of joy.", author: "Mark Twain" },
  { text: "Worrying is like paying a debt you don't owe.", author: "Mark Twain" },
  { text: "Don't cry because it's over, smile because it happened.", author: "Dr. Seuss" },
  { text: "Today you are You, that is truer than true. There is no one alive who is Youer than You.", author: "Dr. Seuss" },
  { text: "You have brains in your head. You have feet in your shoes. You can steer yourself any direction you choose.", author: "Dr. Seuss" },
  { text: "I have decided to stick with love. Hate is too great a burden to bear.", author: "Martin Luther King Jr." },
  { text: "The time is always right to do what is right.", author: "Martin Luther King Jr." },
  { text: "Faith is taking the first step even when you don't see the whole staircase.", author: "Martin Luther King Jr." },
  { text: "Darkness cannot drive out darkness; only light can do that.", author: "Martin Luther King Jr." },
  { text: "We must accept finite disappointment, but never lose infinite hope.", author: "Martin Luther King Jr." },
  { text: "There is no exercise better for the heart than reaching down and lifting people up.", author: "John Holmes" },
  { text: "No act of kindness, no matter how small, is ever wasted.", author: "Aesop" },
  { text: "Slow and steady wins the race.", author: "Aesop" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "I learned that courage was not the absence of fear, but the triumph over it.", author: "Nelson Mandela" },
  { text: "I never lose. I either win or learn.", author: "Nelson Mandela" },
  { text: "Resentment is like drinking poison and then hoping it will kill your enemies.", author: "Nelson Mandela" },
  { text: "There is no passion to be found playing small — in settling for a life that is less than the one you are capable of living.", author: "Nelson Mandela" },
  { text: "May your choices reflect your hopes, not your fears.", author: "Nelson Mandela" },
  { text: "What counts in life is not the mere fact that we have lived. It is what difference we have made to the lives of others.", author: "Nelson Mandela" },
  { text: "Without a struggle, there can be no progress.", author: "Frederick Douglass" },
  { text: "If there is no struggle, there is no progress.", author: "Frederick Douglass" },
  { text: "It is easier to build strong children than to repair broken men.", author: "Frederick Douglass" },
  { text: "I would unite with anybody to do right; and with nobody to do wrong.", author: "Frederick Douglass" },
  { text: "What looks like the end of the road, is actually a bend in the road.", author: "Frederick Douglass" },
  { text: "I would rather walk with a friend in the dark, than alone in the light.", author: "Helen Keller" },
  { text: "The only journey is the one within.", author: "Rainer Maria Rilke" },
  { text: "Be patient toward all that is unsolved in your heart and try to love the questions themselves.", author: "Rainer Maria Rilke" },
  { text: "You must give birth to your images. They are the future waiting to be born.", author: "Rainer Maria Rilke" },
  { text: "Let everything happen to you: beauty and terror. Just keep going. No feeling is final.", author: "Rainer Maria Rilke" },
  { text: "Perhaps all the dragons in our lives are princesses who are only waiting to see us act, just once, with beauty and courage.", author: "Rainer Maria Rilke" },
  { text: "The most beautiful people we have known are those who have known defeat, known suffering, known struggle, known loss, and have found their way out of the depths.", author: "Elisabeth Kübler-Ross" },
  { text: "Tension is who you think you should be. Relaxation is who you are.", author: "Chinese proverb" },
  { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese proverb" },
  { text: "What you cannot avoid, welcome.", author: "Chinese proverb" },
  { text: "Fall seven times, stand up eight.", author: "Japanese proverb" },
  { text: "Smooth seas do not make skillful sailors.", author: "African proverb" },
  { text: "If you want to go fast, go alone. If you want to go far, go together.", author: "African proverb" },
  { text: "Forget the mistake. Remember the lesson.", author: "Anonymous" },

  // Tolkien / Lewis / Montgomery
  { text: "Not all those who wander are lost.", author: "J.R.R. Tolkien" },
  { text: "All we have to decide is what to do with the time that is given us.", author: "J.R.R. Tolkien" },
  { text: "It is no bad thing to celebrate a simple life.", author: "J.R.R. Tolkien" },
  { text: "There are far, far better things ahead than any we leave behind.", author: "C.S. Lewis" },
  { text: "You can't go back and change the beginning, but you can start where you are and change the ending.", author: "C.S. Lewis" },
  { text: "Isn't it nice to think that tomorrow is a new day with no mistakes in it yet?", author: "L.M. Montgomery" },

  // Sciences & Imagination
  { text: "Nothing in life is to be feared, it is only to be understood. Now is the time to understand more, so that we may fear less.", author: "Marie Curie" },
  { text: "Try not to become a man of success, but rather try to become a man of value.", author: "Albert Einstein" },
  { text: "The important thing is not to stop questioning. Curiosity has its own reason for existing.", author: "Albert Einstein" },
  { text: "Logic will get you from A to B. Imagination will take you everywhere.", author: "Albert Einstein" },
  { text: "The most beautiful experience we can have is the mysterious.", author: "Albert Einstein" },
  { text: "A person who never made a mistake never tried anything new.", author: "Albert Einstein" },
  { text: "Strive not to be a success, but rather to be of value.", author: "Albert Einstein" },
  { text: "In the middle of difficulty lies opportunity.", author: "Albert Einstein" },
  { text: "Look deep into nature, and then you will understand everything better.", author: "Albert Einstein" },
  { text: "There are only two ways to live your life. One is as though nothing is a miracle. The other is as though everything is a miracle.", author: "Albert Einstein" },
  { text: "Imagination is more important than knowledge.", author: "Albert Einstein" },
  { text: "Out of clutter, find simplicity. From discord, find harmony. In the middle of difficulty lies opportunity.", author: "Albert Einstein" },
  { text: "I am enough of an artist to draw freely upon my imagination.", author: "Albert Einstein" },
  { text: "Few are those who see with their own eyes and feel with their own hearts.", author: "Albert Einstein" },
  { text: "I do not know what I may appear to the world, but to myself I seem to have been only like a boy playing on the seashore.", author: "Isaac Newton" },
  { text: "If I have seen further it is by standing on the shoulders of Giants.", author: "Isaac Newton" },
  { text: "We build too many walls and not enough bridges.", author: "Isaac Newton" },
  { text: "The greatest reward for doing is the opportunity to do more.", author: "Jonas Salk" },
  { text: "Hope lies in dreams, in imagination, and in the courage of those who dare to make dreams into reality.", author: "Jonas Salk" },
  { text: "Our greatest responsibility is to be good ancestors.", author: "Jonas Salk" },

  // Wilde / Frank / Hepburn / Ruskin
  { text: "We are all in the gutter, but some of us are looking at the stars.", author: "Oscar Wilde" },
  { text: "Be yourself; everyone else is already taken.", author: "Oscar Wilde" },
  { text: "How wonderful it is that nobody need wait a single moment before starting to improve the world.", author: "Anne Frank" },
  { text: "Whoever is happy will make others happy too.", author: "Anne Frank" },
  { text: "The most important thing is to enjoy your life — to be happy — it's all that matters.", author: "Audrey Hepburn" },
  { text: "Nothing is impossible. The word itself says, 'I'm possible!'", author: "Audrey Hepburn" },
  { text: "I believe in pink. I believe that laughing is the best calorie burner.", author: "Audrey Hepburn" },
  { text: "As you grow older, you will discover that you have two hands, one for helping yourself, the other for helping others.", author: "Audrey Hepburn" },
  { text: "Sunshine is delicious, rain is refreshing, wind braces us up, snow is exhilarating; there is really no such thing as bad weather, only different kinds of good weather.", author: "John Ruskin" },
  { text: "Quality is never an accident. It is always the result of intelligent effort.", author: "John Ruskin" },
  { text: "When love and skill work together, expect a masterpiece.", author: "John Ruskin" },
  { text: "What we plant in the soil of contemplation, we shall reap in the harvest of action.", author: "Meister Eckhart" },
  { text: "Do not wait to strike till the iron is hot, but make it hot by striking.", author: "William Butler Yeats" },
  { text: "Education is not the filling of a pail, but the lighting of a fire.", author: "William Butler Yeats" },
  { text: "There are no strangers here; only friends you haven't yet met.", author: "William Butler Yeats" },

  // Hugo / Dostoevsky / Singer / Plath / Baldwin / Dylan / Henley
  { text: "Music expresses that which cannot be said and on which it is impossible to be silent.", author: "Victor Hugo" },
  { text: "Even the darkest night will end and the sun will rise.", author: "Victor Hugo" },
  { text: "To love another person is to see the face of God.", author: "Victor Hugo" },
  { text: "Have courage for the great sorrows of life and patience for the small ones.", author: "Victor Hugo" },
  { text: "Above all, don't lie to yourself.", author: "Fyodor Dostoevsky" },
  { text: "The mystery of human existence lies not in just staying alive, but in finding something to live for.", author: "Fyodor Dostoevsky" },
  { text: "Pain and suffering are always inevitable for a large intelligence and a deep heart.", author: "Fyodor Dostoevsky" },
  { text: "If you want to be respected by others, the great thing is to respect yourself.", author: "Fyodor Dostoevsky" },
  { text: "Beauty will save the world.", author: "Fyodor Dostoevsky" },
  { text: "Everything passes. Everything changes. Just do what you think you should do.", author: "Bob Dylan" },
  { text: "He not busy being born is busy dying.", author: "Bob Dylan" },
  { text: "If you keep on saying things are going to be bad, you have a good chance of being a prophet.", author: "Isaac Bashevis Singer" },
  { text: "Whoever doesn't seek and doesn't search, but waits for someone to bring him the truth, prepares himself for the harshest blow of fate.", author: "Isaac Bashevis Singer" },
  { text: "I am the master of my fate, I am the captain of my soul.", author: "William Ernest Henley" },
  { text: "It matters not how strait the gate, how charged with punishments the scroll.", author: "William Ernest Henley" },

  // Muir / Rilke (more) / Carl-Jung etc already added; rounding out
  { text: "In every walk with nature, one receives far more than he seeks.", author: "John Muir" },
  { text: "The mountains are calling and I must go.", author: "John Muir" },
  { text: "Keep close to Nature's heart… and break clear away, once in a while.", author: "John Muir" },
  { text: "Tension is the enemy of grace.", author: "Helen Hayes" },
  { text: "Believe nothing of what you hear, and only half of what you see.", author: "Edgar Allan Poe" },
];

const QUOTE_HISTORY_KEY = "verseday_quote_history";
const COOLDOWN_MS = 40 * 24 * 60 * 60 * 1000; // 40 days

type QuoteHistory = Record<string, number>;

function loadHistory(): QuoteHistory {
  try {
    const raw = localStorage.getItem(QUOTE_HISTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as QuoteHistory) : {};
  } catch {
    return {};
  }
}

function saveHistory(history: QuoteHistory): void {
  try {
    localStorage.setItem(QUOTE_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // quota / private mode — silently skip; rotation still works,
    // it just won't enforce cooldown across sessions.
  }
}

function getRandomQuote(): Quote {
  const now = Date.now();
  const history = loadHistory();

  // Drop entries older than the cooldown window so the file doesn't
  // grow unbounded and stale quotes return to the eligible pool.
  const fresh: QuoteHistory = {};
  for (const [text, ts] of Object.entries(history)) {
    if (now - ts < COOLDOWN_MS) fresh[text] = ts;
  }

  // Eligible = quotes not in the cooldown window. If somehow every
  // quote has been shown within the last 40 days (hello, future user
  // with hundreds of new quotes added), fall back to the full pool —
  // better to repeat than show nothing.
  const eligible = QUOTES.filter((q) => !(q.text in fresh));
  const pool = eligible.length > 0 ? eligible : QUOTES;
  const chosen = pool[Math.floor(Math.random() * pool.length)];

  fresh[chosen.text] = now;
  saveHistory(fresh);
  return chosen;
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

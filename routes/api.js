const express = require('express');
const multer = require('multer');
const path = require('path');
const Video = require('../model/vd');
const User = require('../model/user'); // Import model User
const NFT = require('../model/nft');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
require('dotenv').config();
const { Connection, PublicKey, Keypair, clusterApiUrl } = require('@solana/web3.js');
const { getOrCreateAssociatedTokenAccount, transfer } = require('@solana/spl-token');
const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

const router = express.Router();

// Cấu hình lưu trữ với multer cho video
const videoStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = path.join(__dirname, '../public/video');
        cb(null, uploadPath); // Thư mục để lưu tệp video
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname); // Đặt tên tệp
    }
});

const videoUpload = multer({ storage: videoStorage });

// Cấu hình lưu trữ với multer cho ảnh
const imageStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = path.join(__dirname, '../public/images');
        cb(null, uploadPath); // Thư mục để lưu tệp ảnh
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname); // Đặt tên tệp
    }
});

const imageUpload = multer({ storage: imageStorage });

// Middleware để tải video lên
router.post('/upload-video', videoUpload.single('file'), async (req, res, next) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).send('No file uploaded.');
        }
        const url = path.join('/videos', file.filename);
        req.videoUrl = url; // Lưu URL tạm thời vào request để sử dụng ở middleware tiếp theo
        next(); // Chuyển sang middleware tiếp theo
    } catch (err) {
        console.error('Error uploading video:', err);
        res.status(500).send('Something went wrong.');
    }
}, async (req, res) => {
    try {
        const { publickey, title, content } = req.body;
        const url = req.videoUrl; // Lấy URL tạm thời đã lưu từ middleware trước đó

        // Tìm user bằng publickey để xác minh rằng người dùng tồn tại
        const user = await User.findOne({ publickey });
        if (!user) {
            return res.status(404).send('User not found.');
        }

        const newVideo = new Video({
            publickey, // Sử dụng publickey của user
            title,
            content,
            url
        });

        await newVideo.save();
        console.log('Video added successfully.');
        res.status(200).send('Video added successfully.');
    } catch (err) {
        console.error('Error saving video:', err);
        res.status(500).send('Something went wrong.');
    }
});

// Endpoint để lấy danh sách tất cả video
router.get('/videos', async (req, res) => {
    try {
        const videos = await Video.find({});
        res.json(videos);
    } catch (err) {
        res.status(500).send('Something went wrong.');
    }
});

// Middleware để tải ảnh lên
router.post('/add-user', imageUpload.single('img'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).send('No image uploaded.');
        }
        const imgPath = '/images/' + file.filename; // Đường dẫn URL cho ảnh

        const { publickey, name, email } = req.body; // Lấy thêm email từ request body
        
        const newUser = new User({
            publickey,
            name,
            email,
            img: imgPath
        });

        await newUser.save();
        console.log('User added successfully.');

        // Sau khi thêm user vào MongoDB, thực hiện POST request
        const apiKey = process.env.APIKEY; // Thay thế bằng API key thực tế của bạn

        const options = {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'x-api-key': apiKey,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
              referenceId: publickey, // Sử dụng publickey làm referenceId
              email: email, // Sử dụng email từ request body
              externalWalletAddress: publickey // Sử dụng publickey làm externalWalletAddress
          })
        };

        fetch('https://api.gameshift.dev/nx/users', options)
          .then(response => response.json())
          .then(response => {
              console.log('API Response:', response);
              res.status(200).send('User added and API request successful.');
          })
          .catch(err => {
              console.error('API Request Error:', err);
              res.status(500).send('User added but API request failed.');
          });

    } catch (err) {
        console.error('Error adding user:', err);
        res.status(500).send('Something went wrong.');
    }
});

// Endpoint để kiểm tra user bằng publickey
router.get('/check-user/:publickey', async (req, res) => {
  try {
      const { publickey } = req.params;
      const user = await User.findOne({ publickey });
      if (user) {
          return res.status(200).json({ exists: true });
      } else {
          return res.status(404).json({ exists: false });
      }
  } catch (err) {
      console.error('Error checking user:', err);
      res.status(500).send('Something went wrong.');
  }
});

// Endpoint để lấy thông tin người dùng theo publickey
router.get('/user/:publickey', async (req, res) => {
  try {
      const { publickey } = req.params;
      const user = await User.findOne({ publickey });
      if (user) {
          return res.status(200).json(user);
      } else {
          return res.status(404).json({ message: 'User not found' });
      }
  } catch (err) {
      console.error('Error fetching user:', err);
      res.status(500).send('Something went wrong.');
  }
});

// Endpoint để lấy tất cả video theo publickey
router.get('/videos/user/:publickey', async (req, res) => {
  try {
      const { publickey } = req.params;
      const videos = await Video.find({ publickey });
      res.json(videos);
  } catch (err) {
      console.error('Error fetching videos:', err);
      res.status(500).send('Something went wrong.');
  }
});

// Endpoint tạo và lưu NFT vào MongoDB
const CollectionId = process.env.collectionId;
router.post('/create-nft', async (req, res) => {
    try {
        const { description, imageUrl, name, publickey , from, to } = req.body;

        // Cấu hình cho fetch
        const options = {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'x-api-key': process.env.APIKEY,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                details: {
                    collectionId: CollectionId,
                    description,
                    imageUrl,
                    name
                },
                destinationUserReferenceId: publickey
            })
        };

        const response = await fetch('https://api.gameshift.dev/nx/unique-assets', options);
        const data = await response.json();

        console.log('API Response:', data); // Ghi lại phản hồi API để kiểm tra cấu trúc

        if (response.ok) {
            const { id, imageUrl: createdImageUrl, name: createdName, description: createdDescription } = data;

            // Lưu thông tin NFT vào MongoDB
            const newNFT = new NFT({
                id,
                imageUrl: createdImageUrl,
                name: createdName,
                description: createdDescription,
                publickey,
                from, // Thêm thuộc tính from
                to     // Thêm thuộc tính to
            });

            await newNFT.save();
            console.log('NFT created and saved successfully.');
            res.status(201).send('NFT created and saved successfully.');
        } else {
            console.error('Failed to create NFT, status:', response.status, data);
            res.status(500).send('Failed to create NFT.');
        }
    } catch (err) {
        console.error('Error creating and saving NFT:', err);
        res.status(500).send('Something went wrong.');
    }
});
// Hàm để niêm yết NFT cho bán
const listNFTForSale = async (idNft, naturalAmount) => {
    const options = {
        method: 'POST',
        headers: {
            accept: 'application/json',
            'x-api-key': process.env.APIKEY,
            'content-type': 'application/json'
        },
        body: JSON.stringify({ price: { currencyId: 'USDC', naturalAmount } })
    };

    try {
        const response = await fetch(`https://api.gameshift.dev/nx/unique-assets/${idNft}/list-for-sale`, options);
        const data = await response.json();
        console.log(data)
        return { status: response.status, data };
    } catch (err) {
        console.error('Error listing NFT for sale:', err);
        throw err;
    }
};

// Endpoint để niêm yết NFT cho bán và trả về consentUrl
router.post('/list-nft-for-sale', async (req, res) => {
    try {
        const { idNft, naturalAmount } = req.body;
        const { status, data } = await listNFTForSale(idNft, naturalAmount);

        if (data.consentUrl) {
            // Trả về consentUrl trong phản hồi JSON
            res.status(200).json({ consentUrl: data.consentUrl });
        } else {
            res.status(500).send('Failed to list NFT for sale. No consent URL provided.');
        }
    } catch (err) {
        res.status(500).send('Something went wrong.');
    }
});
// Endpoint để lấy tất cả NFTs
router.get('/nfts', async (req, res) => {
    try {
        const nfts = await NFT.find({}); // Lấy tất cả NFTs
        res.status(200).json(nfts); // Trả về danh sách NFTs
    } catch (err) {
        console.error('Error fetching NFTs:', err);
        res.status(500).send('Something went wrong.');
    }
});

/// Endpoint để mua NFT
router.post('/buy-nft', async (req, res) => {
    try {
        const { idNFT, buyerId } = req.body;

        // Kiểm tra đầu vào
        if (!idNFT || !buyerId) {
            return res.status(400).json({ error: 'Missing required fields.' });
        }

        // Cấu hình cho fetch
        const options = {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'x-api-key': process.env.APIKEY, // Thay thế bằng API key thực tế của bạn
                'content-type': 'application/json'
            },
            body: JSON.stringify({ buyerId })
        };

        const response = await fetch(`https://api.gameshift.dev/nx/unique-assets/${idNFT}/buy`, options);
        const data = await response.json();
        console.log(data)

        if (response.ok) {
            // Gửi lại phản hồi với URL thanh toán
            res.status(200).json({ consentUrl: data.consentUrl });
        } else {
            // Xử lý các lỗi từ API
            console.error('Failed to buy NFT, status:', response.status, data);
            res.status(response.status).json({ error: 'Failed to buy NFT.' });
        }
    } catch (err) {
        console.error('Error processing request:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// Endpoint để lấy NFT theo ownerReferenceId
router.post('/fetch-nfts', async (req, res) => {
    try {
        const { ownerReferenceId } = req.body;

        if (!ownerReferenceId) {
            return res.status(400).json({ error: 'Missing required field: ownerReferenceId.' });
        }

        const options = {
            method: 'GET',
            headers: {
                accept: 'application/json',
                'x-api-key': process.env.APIKEY
            }
        };

        const response = await fetch(`https://api.gameshift.dev/nx/items?types=&collectionId=${process.env.collectionId}&ownerReferenceId=${ownerReferenceId}`, options);
        const data = await response.json();

        if (response.ok) {
            res.status(200).json(data);
        } else {
            console.error('Failed to fetch NFTs, status:', response.status, data);
            res.status(response.status).json({ error: 'Failed to fetch NFTs.' });
        }
    } catch (err) {
        console.error('Error fetching NFTs:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// Endpoint to update useNft, from, and to fields of a user
// Endpoint to update useNft, from, and to fields of a user
router.put('/update-user-nft/:publickey', async (req, res) => {
    try {
        const { publickey } = req.params;
        const { idNft } = req.body;

        // Find the NFT by its 'id' field
        const nft = await NFT.findOne({ id: idNft });
        if (!nft) {
            return res.status(404).send('NFT not found.');
        }
        console.log('NFT found:', nft);
        console.log('NFT from:', nft.from);
        console.log('NFT to:', nft.to);
        
        // Find and update the user with the NFT details
        const updatedUser = await User.findOneAndUpdate(
            { publickey }, // Find the user by publickey
            {
                $set: {
                    useNft: nft.id, // Update useNft with the NFT id
                    from: nft.from, // Update from with the NFT from value
                    to: nft.to,      // Update to with the NFT to value
                }
            },
            { new: true } // Return the updated user document
        );

        if (!updatedUser) {
            return res.status(404).send('User not found.');
        }

        console.log('User updated successfully with NFT details:', updatedUser);
        res.status(200).json(updatedUser); // Return the updated user
    } catch (err) {
        console.error('Error updating user with NFT details:', err);
        res.status(500).send('Something went wrong.');
    }
});

// Private key của ví gửi (thay bằng ví của bạn)
const senderPrivateKeyArray = JSON.parse(process.env.SENDER_PRIVATE_KEY);
const senderPrivateKey = new Uint8Array(senderPrivateKeyArray);
const senderKeypair = Keypair.fromSecretKey(senderPrivateKey)

// Token Mint Address của SPL Token
const mintPublicKey = new PublicKey('Bw1kdoBCzxKRn2RR1HLFDCEjiHBybQzZsWzWmxwQuniP');

// Endpoint để thực hiện chuyển token
router.post('/transfer', async (req, res) => {
    try {
        const { recipientPublicKeyString, amount } = req.body;

        if (!recipientPublicKeyString || !amount) {
            return res.status(400).send('Thiếu recipientPublicKey hoặc amount');
        }

        // Public key của người nhận
        const recipientPublicKey = new PublicKey(recipientPublicKeyString);

        // Tạo token account hoặc lấy token account của người nhận
        const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
            connection,
            senderKeypair,
            mintPublicKey,
            recipientPublicKey
        );

        // Lấy token account của người gửi
        const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
            connection,
            senderKeypair,
            mintPublicKey,
            senderKeypair.publicKey
        );

        // Thực hiện chuyển token
        const txSignature = await transfer(
            connection,
            senderKeypair,
            senderTokenAccount.address, // Token Account của người gửi
            recipientTokenAccount.address, // Token Account của người nhận
            senderKeypair.publicKey,
            amount * 10**9 // Điều chỉnh theo số chữ số thập phân của token
        );

        res.status(200).json({ message: 'Chuyển token thành công!', txSignature });
    } catch (error) {
        console.error(error);
        res.status(500).send('Đã xảy ra lỗi trong quá trình chuyển token');
    }
});

module.exports = router;